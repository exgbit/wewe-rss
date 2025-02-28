import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';
import got from 'got';
import { load } from 'cheerio';
import { minify } from 'html-minifier';

const prisma = new PrismaClient();
const logger = new Logger('FillArticleContent');

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
        logger.warn(`retrying ${options.url}...`);
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
  const html = await request(url, { responseType: 'text' }).text();
  const result = await cleanHtml(html);
  return result;
}

async function tryGetContent(id: string) {
  const url = `https://mp.weixin.qq.com/s/${id}`;
  const content = await getHtmlByUrl(url).catch((e) => {
    logger.error(`getHtmlByUrl(${url}) error: ${e.message}`);
    return '获取全文失败，请重试~';
  });
  return content;
}

async function main() {
  logger.log('开始填充文章内容...');

  // 获取所有没有内容的文章
  const articles = await prisma.article.findMany({
    where: {
      content: null,
    },
    take: 100, // 每次处理100篇文章，避免一次处理太多
  });

  logger.log(`找到 ${articles.length} 篇没有内容的文章`);

  let successCount = 0;
  let failCount = 0;

  for (const article of articles) {
    try {
      logger.log(`处理文章: ${article.title} (${article.id})`);

      // 获取文章内容
      const content = await tryGetContent(article.id);

      // 更新文章内容
      await prisma.article.update({
        where: { id: article.id },
        data: { content },
      });

      successCount++;

      // 每处理5篇文章暂停一下，避免请求过于频繁
      if (successCount % 5 === 0) {
        logger.log(`已成功处理 ${successCount} 篇文章，暂停30秒...`);
        await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
      }
    } catch (error) {
      logger.error(`处理文章 ${article.id} 失败:`, error);
      failCount++;
    }
  }

  logger.log(`处理完成! 成功: ${successCount}, 失败: ${failCount}`);

  if (articles.length === 100) {
    logger.log('还有更多文章需要处理，请再次运行此脚本');
  }
}

main()
  .catch((e) => {
    logger.error('脚本执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
