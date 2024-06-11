import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { TransactionFoundEvent } from '../account-subscriber/account-subscriber.event';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway()
export class NotificationGateway {
  @WebSocketServer()
  server: Server;

  @OnEvent('transaction.found')
  async push(tx: TransactionFoundEvent) {
    this.server.emit('transaction.found', tx);
  }
}
