#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import got from 'got';
import { load } from 'cheerio';
import { minify } from 'html-minifier';

// 简单的日志函数
function log(message: string) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${message}`);
}

function error(message: string, err?: any) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ERROR: ${message}`);
  if (err) {
    console.error(err);
  }
}

const prisma = new PrismaClient();

const request = got.extend({
  retry: {
    limit: 3,
    methods: ['GET'],
  },
  timeout: 8 * 1e3,
  headers: {
    accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'max-age=0',
    'sec-ch-ua':
      '" Not A;Brand";v="99", "Chromium";v="101", "Google Chrome";v="101"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36',
  },
  hooks: {
    beforeRetry: [
      async (options, error, retryCount) => {
        log(`重试 ${options.url}...`);
        return new Promise((resolve) =>
          setTimeout(resolve, 2e3 * (retryCount || 1)),
        );
      },
    ],
  },
});

async function cleanHtml(source: string) {
  const $ = load(source, { decodeEntities: false });

  const dirtyHtml = $.html($('.rich_media_content'));

  const html = dirtyHtml
    .replace(/data-src=/g, 'src=')
    .replace(/opacity: 0( !important)?;/g, '')
    .replace(/visibility: hidden;/g, '');

  const content =
    '<style> .rich_media_content {overflow: hidden;color: #222;font-size: 17px;word-wrap: break-word;-webkit-hyphens: auto;-ms-hyphens: auto;hyphens: auto;text-align: justify;position: relative;z-index: 0;}.rich_media_content {font-size: 18px;}</style>' +
    html;

  const result = minify(content, {
    removeAttributeQuotes: true,
    collapseWhitespace: true,
  });

  return result;
}

async function getHtmlByUrl(url: string) {
  log(`获取URL内容: ${url}`);
  const html = await request(url, { responseType: 'text' }).text();
  log(`清理HTML内容...`);
  const result = await cleanHtml(html);
  return result;
}

async function tryGetContent(id: string) {
  const url = `https://mp.weixin.qq.com/s/${id}`;
  try {
    const content = await getHtmlByUrl(url);
    return content;
  } catch (e) {
    error(`获取文章内容失败 (${url}): ${e.message}`, e);
    return '获取全文失败，请重试~';
  }
}

async function main() {
  log('=== 开始填充文章内容 ===');

  try {
    log('连接数据库...');

    // 使用原始SQL查询获取没有内容的文章
    log('查询没有内容的文章...');
    const articles = await prisma.$queryRaw<
      Array<{
        id: string;
        title: string;
        mpId: string;
        picUrl: string;
        publishTime: number;
      }>
    >`
      SELECT id, title, mp_id as "mpId", pic_url as "picUrl", publish_time as "publishTime"
      FROM articles
      WHERE content IS NULL
      and publish_time > UNIX_TIMESTAMP(DATE_SUB(NOW(), INTERVAL 3 DAY))
      ORDER BY publish_time DESC
      LIMIT 1000
    `;

    log(`找到 ${articles.length} 篇没有内容的文章`);

    if (articles.length === 0) {
      log('没有需要填充内容的文章，任务结束');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const article of articles) {
      try {
        log(
          `处理文章 [${successCount + failCount + 1}/${articles.length}]: ${article.title} (${article.id})`,
        );

        // 获取文章内容
        const content = await tryGetContent(article.id);

        // 使用原始SQL更新文章内容
        log(`更新文章内容到数据库...`);
        await prisma.$executeRaw`
          UPDATE articles
          SET content = ${content}
          WHERE id = ${article.id}
        `;

        successCount++;
        log(`文章处理成功: ${article.title}`);

        // 每处理5篇文章暂停一下，避免请求过于频繁
        if (successCount % 5 === 0) {
          log(`已成功处理 ${successCount} 篇文章，暂停40秒...`);
          await new Promise((resolve) => setTimeout(resolve, 40 * 1000));
        }
      } catch (e) {
        error(`处理文章失败 ${article.id}: ${e.message}`, e);
        failCount++;
      }
    }

    log(`=== 处理完成! 成功: ${successCount}, 失败: ${failCount} ===`);
  } catch (e) {
    error('执行过程中发生错误', e);
  }
}

log('脚本开始执行...');

main()
  .catch((e) => {
    error('脚本执行失败', e);
    process.exit(1);
  })
  .finally(async () => {
    log('关闭数据库连接...');
    await prisma.$disconnect();
    log('脚本执行结束');
  });
