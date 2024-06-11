import { Module } from '@nestjs/common';
import { AppController } from './app.controller';

// Build-in
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
// Imports
import { TonModule } from './modules/ton/ton.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AccountSubscriberModule } from './modules/account-subscriber/account-subscriber.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountTransactionModule } from './modules/account-transaction/account-transaction.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    // Build-in
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        url: configService.get('POSTGRES_URL'),
        type: 'postgres',
        autoLoadEntities: true,
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    // Imports
    TonModule,
    AccountSubscriberModule,
    AccountTransactionModule,
    NotificationModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
