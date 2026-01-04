const fs = require('fs')
const path = require('path')
const express = require('express')
const request = require('./util/request')
const packageJSON = require('./package.json')
const { spawn, exec } = require('child_process')
const cache = require('./util/apicache').middleware
const { cookieToJson } = require('./util/index')
const fileUpload = require('express-fileupload')
const decode = require('safe-decode-uri-component')

/**
 * The version check result.
 * @readonly
 * @enum {number}
 */
const VERSION_CHECK_RESULT = {
  FAILED: -1,
  NOT_LATEST: 0,
  LATEST: 1,
}

/**
 * @typedef {{
 *   identifier?: string,
 *   route: string,
 *   module: any
 * }} ModuleDefinition
 */

/**
 * @typedef {{
 *   port?: number,
 *   host?: string,
 *   checkVersion?: boolean,
 *   moduleDefs?: ModuleDefinition[]
 * }} NcmApiOptions
 */

/**
 * @typedef {{
 *   status: VERSION_CHECK_RESULT,
 *   ourVersion?: string,
 *   npmVersion?: string,
 * }} VersionCheckResult
 */

/**
 * @typedef {{
 *  server?: import('http').Server,
 * }} ExpressExtension
 */

/**
 * Get the module definitions dynamically.
 *
 * @param {string} modulesPath The path to modules (JS).
 * @param {Record<string, string>} [specificRoute] The specific route of specific modules.
 * @param {boolean} [doRequire] If true, require() the module directly.
 * Otherwise, print out the module path. Default to true.
 * @returns {Promise<ModuleDefinition[]>} The module definitions.
 *
 * @example getModuleDefinitions("./module", {"album_new.js": "/album/create"})
 */
async function getModulesDefinitions(
  modulesPath,
  specificRoute,
  doRequire = true,
) {
  const files = await fs.promises.readdir(modulesPath)
  const parseRoute = (/** @type {string} */ fileName) =>
    specificRoute && fileName in specificRoute
      ? specificRoute[fileName]
      : `/${fileName.replace(/\.js$/i, '').replace(/_/g, '/')}`

  const modules = files
    .reverse()
    .filter((file) => file.endsWith('.js'))
    .map((file) => {
      const identifier = file.split('.').shift()
      const route = parseRoute(file)
      const modulePath = path.join(modulesPath, file)
      const module = doRequire ? require(modulePath) : modulePath

      return { identifier, route, module }
    })

  return modules
}

/**
 * Check if the version of this API is latest.
 *
 * @returns {Promise<VersionCheckResult>} If true, this API is up-to-date;
 * otherwise, this API should be upgraded and you would
 * need to notify users to upgrade it manually.
 */
async function checkVersion() {
  return new Promise((resolve) => {
    exec('npm info NeteaseCloudMusicApi version', (err, stdout) => {
      if (!err) {
        let version = stdout.trim()

        /**
         * @param {VERSION_CHECK_RESULT} status
         */
        const resolveStatus = (status) =>
          resolve({
            status,
            ourVersion: packageJSON.version,
            npmVersion: version,
          })

        resolveStatus(
          packageJSON.version < version
            ? VERSION_CHECK_RESULT.NOT_LATEST
            : VERSION_CHECK_RESULT.LATEST,
        )
      } else {
        resolve({
          status: VERSION_CHECK_RESULT.FAILED,
        })
      }
    })
  })
}

/**
 * Construct the server of NCM API.
 *
 * @param {ModuleDefinition[]} [moduleDefs] Customized module definitions [advanced]
 * @returns {Promise<import("express").Express>} The server instance.
 */
async function consturctServer(moduleDefs) {
  const app = express()
  const { CORS_ALLOW_ORIGIN } = process.env
  app.set('trust proxy', true)

  /**
   * CORS & Preflight request
   */
  app.use((req, res, next) => {
    if (req.path !== '/') {
      const origin = req.headers.origin;
      if (origin) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Credentials', 'true');
        res.set('Vary', 'Origin');
      } else {
        res.set('Access-Control-Allow-Origin', '*');
      }
      res.set({
        'Access-Control-Allow-Headers': 'X-Requested-With,Content-Type,Cookie,Token',
        'Access-Control-Allow-Methods': 'PUT,POST,GET,DELETE,OPTIONS',
      })
      // 调试日志：检查跨域握手
      if (req.method === 'OPTIONS') {
        console.log(`[CORS PREFLIGHT] Origin: ${origin || 'none'}`);
      }
    }
    req.method === 'OPTIONS' ? res.status(204).end() : next()
  })

  /**
   * Serving static files (Adaptive path for Dev and Prod)
   */
  const baseDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : __dirname;
  const staticPath = fs.existsSync(path.join(baseDir, '../public'))
    ? path.join(baseDir, '../public')
    : path.join(baseDir, 'public');
  console.log(`[MusicAPI] 静态资源目录: ${staticPath}`);

  // 显式设置跨域头
  app.use(express.static(staticPath, {
    setHeaders: (res) => {
      res.set('Access-Control-Allow-Origin', '*');
    }
  }))

  /**
   * Cookie Parser
   */
  app.use((req, _, next) => {
    req.cookies = {}
      //;(req.headers.cookie || '').split(/\s*;\s*/).forEach((pair) => { //  Polynomial regular expression //
      ; (req.headers.cookie || '').split(/;\s+|(?<!\s)\s+$/g).forEach((pair) => {
        let crack = pair.indexOf('=')
        if (crack < 1 || crack == pair.length - 1) return
        req.cookies[decode(pair.slice(0, crack)).trim()] = decode(
          pair.slice(crack + 1),
        ).trim()
      })
    next()
  })

  /**
   * Body Parser and File Upload
   */
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: false, limit: '50mb' }))

  app.use(fileUpload())

  /**
   * Cache (Only for JSON API, skip binary assets)
   */
  app.use(cache('2 minutes', (req, res) => {
    // 排除二进制文件路径
    if (req.path.includes('/image')) {
      return false;
    }
    return res.statusCode === 200;
  }))

  /**
   * Local Image Discovery
   */
  app.get('/local/images', async (req, res) => {
    try {
      const baseDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : __dirname;
      const imagePath = path.join(baseDir, '../public/image')
      const files = await fs.promises.readdir(imagePath)
      const images = files.filter(file =>
        /\.(png|jpe?g|webp|gif)$/i.test(file)
      )
      res.json({ code: 200, images })
    } catch (err) {
      console.error('[LocalImages] Error:', err)
      res.json({ code: 500, images: [], error: err.message })
    }
  })

  /**
   * Local Image Upload
   */
  app.post('/local/image/upload', async (req, res) => {
    try {
      if (!req.files || Object.keys(req.files).length === 0) {
        return res.status(400).json({ code: 400, msg: 'No files were uploaded.' });
      }

      const imageFile = req.files.image;
      const baseDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : __dirname;
      const imagePath = path.join(baseDir, '../public/image');

      // Ensure directory exists
      if (!fs.existsSync(imagePath)) {
        fs.mkdirSync(imagePath, { recursive: true });
      }

      const uploadPath = path.join(imagePath, imageFile.name);

      await imageFile.mv(uploadPath);
      console.log(`[Upload] Saved: ${imageFile.name}`);
      res.json({ code: 200, msg: 'File uploaded!', filename: imageFile.name });
    } catch (err) {
      console.error('[Upload] Error:', err);
      res.status(500).json({ code: 500, msg: err.message });
    }
  })

  /**
   * Local Image Delete
   */
  app.delete('/local/image/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      const baseDir = typeof process.pkg !== 'undefined' ? path.dirname(process.execPath) : __dirname;
      const imagePath = path.join(baseDir, '../public/image', filename);

      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        console.log(`[Delete] Removed: ${filename}`);
        res.json({ code: 200, msg: 'File deleted!' });
      } else {
        res.status(404).json({ code: 404, msg: 'File not found' });
      }
    } catch (err) {
      console.error('[Delete] Error:', err);
      res.status(500).json({ code: 500, msg: err.message });
    }
  })

  /**
   * Special Routers
   */
  const special = {
    'daily_signin.js': '/daily_signin',
    'fm_trash.js': '/fm_trash',
    'personal_fm.js': '/personal_fm',
  }

  /**
   * Load every modules in this directory
   */
  const moduleDefinitions =
    moduleDefs ||
    (await getModulesDefinitions(path.join(__dirname, 'module'), special))

  for (const moduleDef of moduleDefinitions) {
    // Register the route.
    app.use(moduleDef.route, async (req, res) => {
      ;[req.query, req.body].forEach((item) => {
        if (typeof item.cookie === 'string') {
          item.cookie = cookieToJson(decode(item.cookie))
        }
      })

      let query = Object.assign(
        {},
        { cookie: req.cookies },
        req.query,
        req.body,
        req.files,
      )

      try {
        const moduleResponse = await moduleDef.module(query, (...params) => {
          // 参数注入客户端IP
          const obj = [...params]
          let ip = req.ip

          if (ip.substr(0, 7) == '::ffff:') {
            ip = ip.substr(7)
          }
          if (ip == '::1') {
            ip = global.cnIp
          }
          // console.log(ip)
          obj[3] = {
            ...obj[3],
            ip,
          }
          return request(...obj)
        })
        console.log('[OK]', decode(req.originalUrl))

        const cookies = moduleResponse.cookie
        if (!query.noCookie) {
          if (Array.isArray(cookies) && cookies.length > 0) {
            if (req.protocol === 'https') {
              // Try to fix CORS SameSite Problem
              res.append(
                'Set-Cookie',
                cookies.map((cookie) => {
                  return cookie + '; SameSite=None; Secure'
                }),
              )
            } else {
              res.append('Set-Cookie', cookies)
            }
          }
        }
        res.status(moduleResponse.status).send(moduleResponse.body)
      } catch (/** @type {*} */ moduleResponse) {
        console.log('[ERR]', decode(req.originalUrl), {
          status: moduleResponse.status,
          body: moduleResponse.body,
        })
        if (!moduleResponse.body) {
          res.status(404).send({
            code: 404,
            data: null,
            msg: 'Not Found',
          })
          return
        }
        if (moduleResponse.body.code == '301')
          moduleResponse.body.msg = '需要登录'
        if (!query.noCookie) {
          res.append('Set-Cookie', moduleResponse.cookie)
        }

        res.status(moduleResponse.status).send(moduleResponse.body)
      }
    })
  }

  return app
}

/**
 * Serve the NCM API.
 * @param {NcmApiOptions} options
 * @returns {Promise<import('express').Express & ExpressExtension>}
 */
async function serveNcmApi(options) {
  const port = Number(options.port || process.env.PORT || '3000')
  const host = options.host || process.env.HOST || ''

  const checkVersionSubmission =
    options.checkVersion &&
    checkVersion().then(({ npmVersion, ourVersion, status }) => {
      if (status == VERSION_CHECK_RESULT.NOT_LATEST) {
        console.log(
          `最新版本: ${npmVersion}, 当前版本: ${ourVersion}, 请及时更新`,
        )
      }
    })
  const constructServerSubmission = consturctServer(options.moduleDefs)

  const [_, app] = await Promise.all([
    checkVersionSubmission,
    constructServerSubmission,
  ])

  /** @type {import('express').Express & ExpressExtension} */
  const appExt = app
  appExt.server = app.listen(port, host, () => {
    console.log(`[MusicAPI] 服务运行在 @ http://${host ? host : '127.0.0.1'}:${port}`)
    console.log(`[MusicAPI] 确认监听端口: ${port}`)
  })

  return appExt
}

module.exports = {
  serveNcmApi,
  getModulesDefinitions,
}
