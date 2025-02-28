import { Module, forwardRef } from '@nestjs/common';
import { FeedsController } from './feeds.controller';
import { FeedsService } from './feeds.service';
import { PrismaModule } from '@server/prisma/prisma.module';
import { TrpcModule } from '@server/trpc/trpc.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [PrismaModule, forwardRef(() => TrpcModule), ConfigModule],
  controllers: [FeedsController],
  providers: [FeedsService],
  exports: [FeedsService],
})
export class FeedsModule {}
