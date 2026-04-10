/**
 * 集成测试：验证修复后的游戏功能
 * 1. 启动服务器
 * 2. 测试HTTP方法限制
 * 3. 测试页面基本功能
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 8000;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_START_TIMEOUT = 5000; // 5秒超时

console.log('=== 集成测试：验证修复后的游戏功能 ===\n');

let serverProcess = null;

// 启动服务器
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('启动游戏服务器...');
    serverProcess = spawn('node', ['server.js'], {
      stdio: 'pipe',
      cwd: __dirname
    });

    let serverReady = false;
    const timeoutId = setTimeout(() => {
      if (!serverReady) {
        serverProcess.kill();
        reject(new Error(`服务器启动超时 (${SERVER_START_TIMEOUT}ms)`));
      }
    }, SERVER_START_TIMEOUT);

    // 监听服务器输出
    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`服务器输出: ${output.trim()}`);

      if (output.includes(`Server running at http://localhost:${PORT}/`)) {
        serverReady = true;
        clearTimeout(timeoutId);
        console.log('✅ 服务器启动成功');
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`服务器错误: ${data.toString()}`);
    });

    serverProcess.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(new Error(`服务器启动失败: ${error.message}`));
    });

    serverProcess.on('exit', (code) => {
      if (!serverReady && code !== null) {
        clearTimeout(timeoutId);
        reject(new Error(`服务器意外退出，代码: ${code}`));
      }
    });
  });
}

// 停止服务器
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      resolve();
      return;
    }

    console.log('停止游戏服务器...');
    serverProcess.kill('SIGTERM');

    const timeoutId = setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill('SIGKILL');
      }
      resolve();
    }, 3000);

    serverProcess.on('exit', () => {
      clearTimeout(timeoutId);
      serverProcess = null;
      console.log('✅ 服务器已停止');
      resolve();
    });
  });
}

// 测试HTTP请求
async function testHttpRequest(method, expectedStatus, description) {
  try {
    const response = await fetch(`${BASE_URL}/index.html`, {
      method: method,
      headers: {
        'User-Agent': 'Integration Test'
      }
    });

    const success = response.status === expectedStatus;
    console.log(`${success ? '✅' : '❌'} ${description}`);
    console.log(`  状态: ${response.status} ${response.statusText}`);

    if (method === 'POST' && response.status === 405) {
      const allowHeader = response.headers.get('Allow');
      console.log(`  Allow头部: ${allowHeader}`);
      if (allowHeader && allowHeader.includes('GET') && allowHeader.includes('HEAD')) {
        console.log('  ✅ Allow头部正确');
      } else {
        console.log('  ❌ Allow头部不正确');
        return false;
      }
    }

    return success;
  } catch (error) {
    console.log(`❌ ${description}`);
    console.log(`  错误: ${error.message}`);
    return false;
  }
}

// 测试页面内容
async function testPageContent() {
  try {
    const response = await fetch(`${BASE_URL}/index.html`);
    const html = await response.text();

    console.log('\n测试页面内容...');

    // 检查关键元素是否存在
    const checks = [
      { element: 'canvas#gameBoard', found: html.includes('id="gameBoard"') },
      { element: 'div#currentPlayer', found: html.includes('id="currentPlayer"') },
      { element: 'div#gameStatus', found: html.includes('id="gameStatus"') },
      { element: 'button#restartBtn', found: html.includes('id="restartBtn"') },
      { element: 'button#undoBtn', found: html.includes('id="undoBtn"') },
      { element: 'button#hintBtn', found: html.includes('id="hintBtn"') },
      { element: 'script[type="module"]', found: html.includes('type="module" src="js/game.js"') }
    ];

    let allPassed = true;
    for (const check of checks) {
      if (check.found) {
        console.log(`  ✅ 找到元素: ${check.element}`);
      } else {
        console.log(`  ❌ 未找到元素: ${check.element}`);
        allPassed = false;
      }
    }

    // 检查游戏标题
    if (html.includes('五子棋') && html.includes('连五游戏')) {
      console.log('  ✅ 页面标题和内容正确');
    } else {
      console.log('  ❌ 页面标题或内容不正确');
      allPassed = false;
    }

    return allPassed;
  } catch (error) {
    console.log(`❌ 页面内容测试失败: ${error.message}`);
    return false;
  }
}

// 测试静态文件服务
async function testStaticFiles() {
  console.log('\n测试静态文件服务...');

  const filesToTest = [
    { path: '/css/style.css', type: 'text/css', description: 'CSS文件' },
    { path: '/js/game.js', type: 'application/javascript', description: '游戏JS文件' },
    { path: '/js/board.js', type: 'application/javascript', description: '棋盘逻辑文件' },
    { path: '/js/utils.js', type: 'application/javascript', description: '工具函数文件' }
  ];

  let allPassed = true;

  for (const file of filesToTest) {
    try {
      const response = await fetch(`${BASE_URL}${file.path}`);

      if (response.status === 200) {
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes(file.type)) {
          console.log(`  ✅ ${file.description}: 成功加载 (${contentType})`);
        } else {
          console.log(`  ⚠️ ${file.description}: 加载成功但Content-Type不正确`);
          console.log(`     期望: ${file.type}, 实际: ${contentType}`);
        }
      } else {
        console.log(`  ❌ ${file.description}: 加载失败 (${response.status})`);
        allPassed = false;
      }
    } catch (error) {
      console.log(`  ❌ ${file.description}: 请求失败 - ${error.message}`);
      allPassed = false;
    }
  }

  return allPassed;
}

// 主测试函数
async function runIntegrationTests() {
  try {
    // 启动服务器
    await startServer();

    // 等待服务器完全就绪
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('\n--- 开始测试 ---\n');

    // 测试HTTP方法限制
    console.log('1. 测试HTTP方法限制:');
    const httpTests = [
      await testHttpRequest('GET', 200, 'GET请求应该成功'),
      await testHttpRequest('POST', 405, 'POST请求应该返回405'),
      await testHttpRequest('PUT', 405, 'PUT请求应该返回405'),
      await testHttpRequest('HEAD', 200, 'HEAD请求应该成功')
    ];

    const httpTestsPassed = httpTests.every(test => test);
    console.log(`\n✅ HTTP方法限制测试: ${httpTestsPassed ? '全部通过' : '有失败'}`);

    // 测试页面内容
    const pageContentPassed = await testPageContent();
    console.log(`\n✅ 页面内容测试: ${pageContentPassed ? '通过' : '失败'}`);

    // 测试静态文件
    const staticFilesPassed = await testStaticFiles();
    console.log(`\n✅ 静态文件测试: ${staticFilesPassed ? '通过' : '失败'}`);

    // 总结
    console.log('\n=== 测试总结 ===');
    console.log(`HTTP方法限制: ${httpTestsPassed ? '✅' : '❌'}`);
    console.log(`页面内容: ${pageContentPassed ? '✅' : '❌'}`);
    console.log(`静态文件: ${staticFilesPassed ? '✅' : '❌'}`);

    const allTestsPassed = httpTestsPassed && pageContentPassed && staticFilesPassed;
    console.log(`\n总体结果: ${allTestsPassed ? '✅ 所有测试通过' : '❌ 有测试失败'}`);

    return allTestsPassed;

  } catch (error) {
    console.error(`\n❌ 集成测试失败: ${error.message}`);
    return false;
  } finally {
    // 确保服务器停止
    await stopServer();
  }
}

// 运行测试
try {
  const success = await runIntegrationTests();
  process.exit(success ? 0 : 1);
} catch (error) {
  console.error('测试执行错误:', error);
  process.exit(1);
}