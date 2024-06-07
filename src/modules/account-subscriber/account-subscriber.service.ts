import { Injectable, Logger } from '@nestjs/common';
import { Address, Transaction } from '@ton/core';
import { TonService } from '../ton/ton.service';
import { ConfigService } from '@nestjs/config';
import { TonClient } from '@ton/ton';
import { Cron, CronExpression } from '@nestjs/schedule';
import { parseBody } from 'src/utils/ton';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TransactionFoundEvent } from './account-subscriber.event';

export const TRANSACTION_BATCH_SIZE = 10;
export const MAX_TRIES_COUNT = 5;

@Injectable()
export class AccountSubscriberService {
  private logger = new Logger(AccountSubscriberService.name);

  private cacheLastTimestamp: number = Math.floor(new Date().getTime() / 1000); // Init cache last timestamp to prevent query all transactions when init
  private cacheRecentTransactions: Map<string, boolean> = new Map();
  private ton: TonClient;
  private account: string;
  private processing: boolean = false; // Only 1 worker is working

  constructor(
    private tonService: TonService,
    private configService: ConfigService,
    private eventEmitter: EventEmitter2,
  ) {
    this.ton = this.tonService.ton;
    this.account = this.configService.get<string>('ACCOUNT_ADDRESS');
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async sync() {
    if (this.processing) {
      return;
    }

    this.logger.debug(`Sync latest transactions every 10 seconds`);
    try {
      this.processing = true;
      const latestTimestamp = await this.getTransactions();
      if (latestTimestamp) {
        this.cacheLastTimestamp = latestTimestamp;
      }
    } catch (error) {
      // Ignore errors
      this.logger.error(error);
    }

    this.processing = false;
  }

  private async getTransactions(
    lastTimestamp = 0,
    lt?: string,
    hash?: string,
  ): Promise<number> {
    if (!lt) {
      this.logger.debug(
        `Try to fetch ${TRANSACTION_BATCH_SIZE} transactions latest`,
      );
    } else {
      this.logger.debug(
        `Try to fetch ${TRANSACTION_BATCH_SIZE} transactions before lt" ${lt}, hash: ${hash}`,
      );
    }

    // Fetch
    // TON transaction has composite ID: account address (on which the transaction took place) + transaction LT (logical time) + transaction hash.
    // So TxID = address+LT+hash, these three parameters uniquely identify the transaction.
    // In our case, we are monitoring one wallet and the address is `accountAddress`.
    let transactions: Transaction[] = [];
    try {
      transactions = await this.tryGetTransactions(lt, hash);
    } catch (e) {
      this.logger.error(`Maximum try ${MAX_TRIES_COUNT} times reach`);
      return 0;
    }

    const filterTransactions = transactions.filter(
      (tx) => tx.now > this.cacheLastTimestamp,
    );

    this.logger.debug(`${filterTransactions.length} found!`);
    if (filterTransactions.length && !lastTimestamp) {
      lastTimestamp = filterTransactions[0].now;
    }

    await this.processTransactions(filterTransactions);

    // All incoming transaction proceed
    if (filterTransactions.length < TRANSACTION_BATCH_SIZE) {
      return lastTimestamp;
    }

    // Process remaining transactions
    const lastTx = transactions[transactions.length - 1];
    return this.getTransactions(
      lastTimestamp,
      lastTx.lt.toString(),
      lastTx.hash().toString('base64'),
    );
  }

  private async processTransactions(transactions: Transaction[]) {
    const newCacheRecentTransactions = new Map<string, boolean>();

    for (const tx of transactions) {
      const hash = tx.hash().toString('base64');
      // If incoming message source address is defined and no outgoing messages - this is incoming Toncoins.
      // ATTENTION: ALWAYS CHECK THAT THERE WERE NO OUTGOING MESSAGES.
      // It is important to check that Toncoins did not bounce back in case of an error.
      if (tx.inMessage && tx.outMessagesCount === 0) {
        if (
          tx.inMessage.info.type == 'internal' &&
          parseBody(tx.inMessage.body).type == 'comment'
        ) {
          // here you find the payment in your database by UUID,
          // check that the payment has not been processed yet and the amount matches,
          // save to the database that this payment has been processed.
          if (!this.cacheRecentTransactions.has(hash)) {
            const transaction = new TransactionFoundEvent();
            transaction.hash = hash;
            transaction.timestamp = tx.now;
            transaction.lt = tx.lt.toString();
            transaction.totalFees = tx.totalFees.coins.toString();
            transaction.source = tx.inMessage.info.src.toString();
            transaction.destination = tx.inMessage.info.dest.toString();
            transaction.value = tx.inMessage.info.value.coins.toString();
            transaction.message = (parseBody(tx.inMessage.body) as any).comment;

            this.eventEmitter.emit('transaction.found', transaction);
            newCacheRecentTransactions.set(hash, true);
          }
        }
      }
    }

    this.cacheRecentTransactions = newCacheRecentTransactions;
  }

  private async tryGetTransactions(lt?: string, hash?: string, retryCount = 0) {
    let transactions: Transaction[] = [];
    try {
      transactions = await this.ton.getTransactions(
        Address.parse(this.account),
        {
          limit: TRANSACTION_BATCH_SIZE,
          lt,
          hash,
          archival: true,
        },
      );
      return transactions;
    } catch (e) {
      this.logger.error(e);
      // if an API error occurs, try again
      if (retryCount == MAX_TRIES_COUNT) {
        throw e;
      }

      this.logger.debug(`Attemps ${retryCount + 1}`);
      return this.tryGetTransactions(lt, hash, retryCount + 1);
    }
  }
}
