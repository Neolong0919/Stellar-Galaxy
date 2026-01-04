#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const tmpPath = require('os').tmpdir()

async function start() {
  try {
    // 检测是否存在 anonymous_token 文件,没有则生成
    if (!fs.existsSync(path.resolve(tmpPath, 'anonymous_token'))) {
      fs.writeFileSync(path.resolve(tmpPath, 'anonymous_token'), '', 'utf-8')
    }
    // 启动时更新anonymous_token
    const generateConfig = require('./generateConfig')
    await generateConfig()
    require('./server').serveNcmApi({
      checkVersion: true,
      port: 4000,
      host: '127.0.0.1'
    })
  } catch (err) {
    console.error('\n[FATAL ERROR] 音乐服务启动失败:')
    console.error(err)
    console.log('\n请检查: 1. 4000 端口是否被占用 (如其他程序或之前的实例)');
    console.log('       2. 是否有防火墙拦截了 node.exe');
    console.log('       3. 是否有杀毒软件删除了 bin 文件夹内的 node.exe 或依赖项');

    // 保持窗口开启以便用户查看错误
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('\n按回车键退出...', () => {
      rl.close();
      process.exit(1);
    });
  }
}
start()
