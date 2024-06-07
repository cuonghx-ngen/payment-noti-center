import { Module } from '@nestjs/common';
import { TonModule } from '../ton/ton.module';
import { ConfigModule } from '@nestjs/config';
import { AccountSubscriberService } from './account-subscriber.service';

@Module({
  imports: [TonModule, ConfigModule],
  providers: [AccountSubscriberService],
})
export class AccountSubscriberModule {}
