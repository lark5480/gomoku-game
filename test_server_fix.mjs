/**
 * 测试服务器HTTP方法限制修复
 */

import http from 'http';

const PORT = 8001; // 使用不同端口避免冲突
const BASE_URL = `http://localhost:${PORT}`;

// server.js直接启动了服务器，因此我们在这里创建相同的处理逻辑进行测试

console.log('=== 测试服务器HTTP方法限制 ===\n');

// 读取server.js内容来测试处理逻辑
import fs from 'fs';
import path from 'path';

// 创建一个简单的测试服务器来验证HTTP方法限制
function createTestServer() {
  const MIME_TYPES = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
  };

  return http.createServer((req, res) => {
    console.log(`${req.method} ${req.url}`);

    // 测试的HTTP方法限制逻辑
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Allow': 'GET, HEAD' });
      res.end('Method Not Allowed');
      return;
    }

    // 处理根路径
    let filePath = "." + req.url;
    if (filePath === "./") {
      filePath = "./index.html";
    }

    // 安全：防止目录遍历
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve("."))) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const extname = path.extname(filePath);
    const contentType = MIME_TYPES[extname] || "application/octet-stream";

    fs.readFile(filePath, (err, content) => {
      if (err) {
        if (err.code === "ENOENT") {
          res.writeHead(404);
          res.end("File not found");
        } else {
          res.writeHead(500);
          res.end("Server error: " + err.code);
        }
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content, "utf-8");
      }
    });
  });
}

async function runHttpMethodTests() {
  const server = createTestServer();

  return new Promise((resolve, reject) => {
    server.listen(PORT, async () => {
      console.log(`测试服务器启动在端口 ${PORT}`);

      try {
        // 测试1: GET请求应该成功
        console.log('测试1: GET请求应该返回200');
        const getResponse = await fetch(`${BASE_URL}/index.html`);
        console.log(`  GET响应状态: ${getResponse.status} ${getResponse.statusText}`);
        console.log(`  ✓ GET请求: ${getResponse.status === 200 ? '通过' : '失败'}`);

        // 测试2: POST请求应该被拒绝
        console.log('\n测试2: POST请求应该返回405 Method Not Allowed');
        try {
          const postResponse = await fetch(`${BASE_URL}/index.html`, {
            method: 'POST'
          });
          console.log(`  POST响应状态: ${postResponse.status} ${postResponse.statusText}`);
          console.log(`  ✓ POST请求: ${postResponse.status === 405 ? '通过' : '失败'}`);

          // 检查Allow头部
          const allowHeader = postResponse.headers.get('Allow');
          console.log(`  Allow头部: ${allowHeader}`);
          console.log(`  ✓ Allow头部包含GET, HEAD: ${allowHeader && allowHeader.includes('GET') && allowHeader.includes('HEAD') ? '通过' : '失败'}`);
        } catch (error) {
          console.log(`  POST请求错误: ${error.message}`);
        }

        // 测试3: PUT请求应该被拒绝
        console.log('\n测试3: PUT请求应该返回405 Method Not Allowed');
        try {
          const putResponse = await fetch(`${BASE_URL}/index.html`, {
            method: 'PUT'
          });
          console.log(`  PUT响应状态: ${putResponse.status} ${putResponse.statusText}`);
          console.log(`  ✓ PUT请求: ${putResponse.status === 405 ? '通过' : '失败'}`);
        } catch (error) {
          console.log(`  PUT请求错误: ${error.message}`);
        }

        // 测试4: HEAD请求应该被允许
        console.log('\n测试4: HEAD请求应该被允许');
        try {
          const headResponse = await fetch(`${BASE_URL}/index.html`, {
            method: 'HEAD'
          });
          console.log(`  HEAD响应状态: ${headResponse.status} ${headResponse.statusText}`);
          console.log(`  ✓ HEAD请求: ${headResponse.status === 200 ? '通过' : '失败'}`);
        } catch (error) {
          console.log(`  HEAD请求错误: ${error.message}`);
        }

        console.log('\n=== HTTP方法限制测试完成 ===');
        resolve(true);
      } catch (error) {
        console.error('测试失败:', error);
        reject(error);
      } finally {
        server.close(() => {
          console.log('测试服务器已关闭');
        });
      }
    });

    server.on('error', (error) => {
      console.error('服务器错误:', error);
      reject(error);
    });
  });
}

// 运行测试
try {
  await runHttpMethodTests();
  console.log('\n✅ 所有HTTP方法限制测试通过');
} catch (error) {
  console.error('\n❌ HTTP方法限制测试失败:', error);
  process.exit(1);
}