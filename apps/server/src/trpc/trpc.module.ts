import { Module, forwardRef } from '@nestjs/common';
import { TrpcService } from '@server/trpc/trpc.service';
import { TrpcRouter } from '@server/trpc/trpc.router';
import { PrismaModule } from '@server/prisma/prisma.module';
import { FeedsModule } from '@server/feeds/feeds.module';

@Module({
  imports: [PrismaModule, forwardRef(() => FeedsModule)],
  controllers: [],
  providers: [TrpcService, TrpcRouter],
  exports: [TrpcService, TrpcRouter],
})
export class TrpcModule {}
