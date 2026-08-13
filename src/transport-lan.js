// src/transport-lan.js —— 局域网 HTTP 传输层（8788）
// 行为与 v0.2.0 完全一致：Bearer token、/api/status|exec|history、首页加载 web/index.html
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PORT, HOST, AGENT_VERSION } from './config.js';

export function createLanTransport({ config, rootDir, executor, history, queue }) {
  function auth(req, res) {
    const h = req.headers.authorization || '';
    if (h !== `Bearer ${config.token}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return false;
    }
    return true;
  }
  function sendJson(res, code, obj) {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(obj));
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
      req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
      req.on('error', () => resolve({}));
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        const webFile = path.join(rootDir, 'web', 'index.html');
        if (existsSync(webFile)) {
          res.end(readFileSync(webFile, 'utf8'));
        } else {
          res.end('<!DOCTYPE html><html><body><h1>deepseekharness-relay</h1><p>web/index.html 缺失</p></body></html>');
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        if (!auth(req, res)) return;
        sendJson(res, 200, { ok: true, agent: 'deepseekharness-relay', version: AGENT_VERSION, time: new Date().toISOString(), pending: queue.size });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        if (!auth(req, res)) return;
        sendJson(res, 200, { ok: true, items: history.list() });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/exec') {
        if (!auth(req, res)) return;
        const body = await readBody(req);
        const task = String(body.task || '').trim();
        if (!task) { sendJson(res, 400, { ok: false, error: 'task 不能为空' }); return; }
        await queue.enqueue(async () => {
          const result = await executor.run(task);
          history.append({ id: crypto.randomUUID(), task, ...result, at: new Date().toISOString() });
          return result;
        }).then((result) => {
          sendJson(res, 200, { ok: true, result });
        }).catch((e) => {
          sendJson(res, 500, { ok: false, error: String(e) });
        });
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
  });

  function start() {
    server.listen(PORT, HOST, () => {
      console.log('==============================================');
      console.log(' deepseekharness-relay Agent v' + AGENT_VERSION);
      console.log('----------------------------------------------');
      console.log(' 控制台: http://<本机局域网IP>:' + PORT);
      console.log(' 本机:   http://127.0.0.1:' + PORT);
      console.log(' Token:  ' + config.token);
      console.log('----------------------------------------------');
      console.log(' 手机使用: 同一 WiFi 下访问 http://<电脑IP>:' + PORT);
      console.log(' 安全: 仅限局域网；请勿将本端口暴露到公网。');
      console.log('==============================================');
    });
    return server;
  }
  return { start, server };
}
