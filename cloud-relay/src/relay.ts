// cloud-relay/src/relay.ts —— Durable Object：每设备一个，承接 Agent 的 WSS 出站长连接
// 用 Cloudflare WebSocket Hibernation API（acceptWebSocket + webSocketMessage/webSocketClose，
// 空闲时释放 actor、由 CF 缓存 WS）以节省资源并天然支持长连接存活。
//
// 职责（对应架构文档第 2 章）：
//   - 承接 Agent 的 agent.hello（deviceToken 校验、绑定/续传、状态上报）
//   - 心跳保持/断线感知（webSocketClose 触发重新拉活）
//   - 任务队列（单设备串行）：手机经控制面 createTask → 写 storage → 本 DO 有连接则下发 task.submit
//   - 上行消息透传（task.status/task.result/confirm.response）写入 DB/回给控制面
//   - 紧急停止 kill、confirm.request 下发
//
// 关键：这是一个**实现骨架**，不含任何真实密钥/服务配置；deploy 由你在已登录 wrangler 的会话执行。

import type { DurableObjectState, DurableObjectNamespace } from '@cloudflare/workers-types';
import type { Envelope } from './protocol.js';
import { MSG_TYPES, parseEnvelope, validateEnvelope } from './protocol.js';

export interface RelayEnv {
  // DO bindings / root fetchable（实际由 worker 注入）
  RELAY_DO: DurableObjectNamespace;
  STORE_URL?: string; // 预留：控制面 REST 基地址，供上报 status 用
}

interface OutboxMsg {
  msgId: string;
  type: Envelope['type'];
  payload: Record<string, unknown>;
  ts: string;
}

const QUEUE_KEY = (deviceId: string) => `device:${deviceId}:queue`;

export class RelayDO {
  state: DurableObjectState;
  env: RelayEnv;
  deviceId: string;
  private ws: WebSocket | null = null;

  constructor(state: DurableObjectState, env: RelayEnv) {
    this.state = state;
    this.env = env;
    // DO id 已由 Worker 端按 deviceId 派生；这里从 storage 读取以确认
    this.deviceId = '';
  }

  // Worker /v1/agent/ws 升级时，经由 DurableObjectNamespace.get(id).fetch(req) 进入这里。
  // 用 Hibernation API 接受 WebSocket。
  async fetch(request: Request): Promise<Response> {
    // 需要升级协议
    const upgrade = request.headers.get('Upgrade');
    if ((upgrade || '').toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const url = new URL(request.url);
    this.deviceId = url.searchParams.get('deviceId') || '';

    // WebSocketPair：server 端 + client 端
    const pair = new WebSocketPair();
    const ws = pair[1]; // server side
    this.ws = ws;
    await this.state.storage.put('deviceId', this.deviceId);

    // Hibernation：注册该 WS；消息/关闭由系统调用 webSocketMessage/webSocketClose
    this.state.acceptWebSocket(ws);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // Hibernation：新消息
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const env = parseEnvelope(message);
    if (!validateEnvelope(env)) return;
    await this.handleFromAgent(env);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.ws = null;
    // 设备离线：若 Worker 端有控制面可调，可在此标记设备 offline
    // 骨架：记录 + 可选通过 env.STORE_URL 通知
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    this.ws = null;
  }

  // ---- 处理 Agent 上行（出站连接发来的消息）----
  private async handleFromAgent(env: Envelope): Promise<void> {
    switch (env.type) {
      case MSG_TYPES.HELLO: {
        const p = env.payload || {};
        // 骨架：记录设备在线；设备状态上报由 Worker/控制面处理
        await this.state.storage.put(`device:${this.deviceId}:online`, true);
        // 回 bind/ack（若已绑定）
        this.reply({ type: MSG_TYPES.PONG });
        // 若队列里有 pending 任务（Agent 断线期间积压），重连后补发
        await this.flushQueue();
        break;
      }
      case MSG_TYPES.PING:
        this.reply({ type: MSG_TYPES.PONG });
        break;
      case MSG_TYPES.PONG:
        // 心跳确认（无需动作）
        break;
      case MSG_TYPES.TASK_STATUS:
      case MSG_TYPES.TASK_RESULT:
      case MSG_TYPES.CONFIRM_RESPONSE:
        // 透传/落库：骨架——记录日志；实际可调用控制面 STORE_URL 或直接写 DB（由 store.ts）
        this.recordUpstream(env.type, env.payload || {});
        break;
      case MSG_TYPES.TASK_ACK:
        // Agent 确认收到下行指令 → 从 outbox 出队
        await this.ackOutbox(env.payload || {});
        break;
      case MSG_TYPES.BYE:
        this.reply({ type: MSG_TYPES.BYE });
        break;
      default:
        break;
    }
  }

  // ---- 下行下发（控制面调用 DO 的方法，生产里经 Worker fetch 路由到 DO）----
  // WebSocket Hibernation 下，从外部触发 DO 用 this.state.storage + 或由控制面经 fetch 调 addTask。
  async addTask(taskId: string, payload: Record<string, unknown>): Promise<void> {
    // 入队（断线期间积压），有连接则立即下发
    const q = (await this.state.storage.get<OutboxMsg[]>(QUEUE_KEY(this.deviceId))) || [];
    q.push({ msgId: taskId, type: MSG_TYPES.TASK_SUBMIT, payload, ts: new Date().toISOString() });
    await this.state.storage.put(QUEUE_KEY(this.deviceId), q);
    await this.flushQueue();
  }

  private async flushQueue(): Promise<void> {
    if (!this.ws) return;
    const q = (await this.state.storage.get<OutboxMsg[]>(QUEUE_KEY(this.deviceId))) || [];
    const rest: OutboxMsg[] = [];
    for (const m of q) {
      // 骨架：直接下发（不阻塞）；实际可靠投递需等待 task.ack（阶段3 完整版）
      this.send({ type: m.type, msgId: m.msgId, payload: m.payload });
    }
    await this.state.storage.put(QUEUE_KEY(this.deviceId), rest);
  }

  private async ackOutbox(payload: Record<string, unknown>): Promise<void> {
    const msgId = String(payload?.msgId || '');
    if (!msgId) return;
    const q = (await this.state.storage.get<OutboxMsg[]>(QUEUE_KEY(this.deviceId))) || [];
    await this.state.storage.put(QUEUE_KEY(this.deviceId), q.filter((m) => m.msgId !== msgId));
  }

  // ---- 发送助手 ----
  private reply(partial: Partial<Envelope>): void {
    const msg: Envelope = {
      v: 1,
      type: (partial.type ?? MSG_TYPES.PONG) as Envelope['type'],
      msgId: partial.msgId ?? newId(),
      seq: 0,
      ts: new Date().toISOString(),
      deviceId: this.deviceId,
      payload: partial.payload ?? {},
    };
    this.send(msg);
  }
  private send(partial: Partial<Envelope>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: Envelope = {
      v: 1,
      type: (partial.type ?? MSG_TYPES.PONG) as Envelope['type'],
      msgId: partial.msgId ?? newId(),
      seq: 0,
      ts: new Date().toISOString(),
      deviceId: this.deviceId,
      payload: partial.payload ?? {},
    };
    this.ws.send(JSON.stringify(msg));
  }
  private recordUpstream(type: string, payload: Record<string, unknown>): void {
    // 骨架：可落库（task_events / audit）——实际接 store.ts；这里仅注释占位
    void type; void payload;
  }
}

function newId(): string {
  return 'm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
