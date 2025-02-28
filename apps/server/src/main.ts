import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { ConfigService } from '@nestjs/config';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigurationType } from './configuration';
import { join, resolve } from 'path';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { Logger } from '@nestjs/common';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, '..', './package.json'), 'utf-8'),
);

const appVersion = packageJson.version;
console.log('appVersion: v' + appVersion);

// 确保日志目录存在
const logDir = join(__dirname, '..', 'logs');
if (!existsSync(logDir)) {
  mkdirSync(logDir, { recursive: true });
}

// 配置全局日志
const logger = new Logger('App');
logger.log(`Starting WeWe-RSS v${appVersion}`);
logger.log(`CRON_EXPRESSION: ${process.env.CRON_EXPRESSION}`);
logger.log(`UPDATE_DELAY_TIME: ${process.env.UPDATE_DELAY_TIME}`);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  const { host, isProd, port } =
    configService.get<ConfigurationType['server']>('server')!;

  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  app.useStaticAssets(join(__dirname, '..', 'client', 'assets'), {
    prefix: '/dash/assets/',
  });
  app.setBaseViewsDir(join(__dirname, '..', 'client'));
  app.setViewEngine('hbs');

  if (isProd) {
    app.enable('trust proxy');
  }

  app.enableCors({
    exposedHeaders: ['authorization'],
  });

  const trpc = app.get(TrpcRouter);
  trpc.applyMiddleware(app);

  await app.listen(port, host);

  console.log(`Server is running at http://${host}:${port}`);
}
bootstrap();
