'use strict'

const path = require('path')
const url = require('url')
const querystring = require('querystring')
const Debug = require('debug')

const {
  app,
  Menu,
  BrowserWindow
} = require('electron')

const rp = require('request-promise')
const Config = require('electron-config')
const windowState = require('electron-window-state')
// const GHUpdater = require('electron-gh-releases')

const config = new Config()
const debug = new Debug('app:app.js')
// const updater = new GHUpdater({
//   repo: 'robjtede/monzoo',
//   currentVersion: app.getVersion()
// })

console.log(`starting ${app.getName()} version ${app.getVersion()}`)

const appInfo = {
  client_id: config.get('client_id'),
  client_secret: config.get('client_secret'),
  redirect_uri: 'monzoo://auth/',
  response_type: 'code',
  state: 'totally random state key for oauth purposes'
}

let mainWindow
let authWindow

const template = [{
  label: 'Application',
  submenu: [
    { label: 'About Application', selector: 'orderFrontStandardAboutPanel:' },
    { type: 'separator' },
    { label: 'Quit', accelerator: 'Command+Q', click: function () { app.quit() }}
  ]}, {
    label: 'Edit',
    submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
      { type: 'separator' },
      { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
      { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
      { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:' }
    ]
  }
]

const checkAccess = () => {
  debug('checkAccess')

  if (!config.has('accessToken')) {
    debug('=> no access token')
    return false
  }

  if (config.has('authTime') && config.has('authExpires')) return checkAuthTimeout()
}

const checkAuthTimeout = () => {
  debug('checkAuthTimeout')

  const valid = config.get('authTime') + config.get('authExpires') > +new Date()

  if (!valid) debug('=> access token expired')
  return valid
}

const createWindow = () => {
  debug('createWindow')

  const mainWindowState = windowState({
    defaultWidth: 550,
    defaultHeight: 800
  })

  mainWindow = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    titleBarStyle: 'hidden-inset'
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  mainWindow.loadURL(url.format({
    pathname: path.resolve(__dirname, 'app/index.html'),
    protocol: 'file:',
    slashes: true
  }))

  mainWindowState.manage(mainWindow)

  mainWindow.on('closed', () => { mainWindow = null })
}

const requestAuth = () => {
  debug('requestAuth')

  debug('clearing auth details')

  authWindow = new BrowserWindow({width: 500, height: 700})

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  // get auth token
  let url = 'https://auth.getmondo.co.uk/'
  url += `?client_id=${appInfo.client_id}`
  url += `&redirect_uri=${appInfo.redirect_uri}`
  url += `&response_type=${appInfo.response_type}`
  url += `&state=${appInfo.state}`

  authWindow.loadURL(url)
}

const getAccessToken = () => {
  debug('getAccessToken')

  return rp({
    uri: 'https://api.monzo.com/oauth2/token',
    method: 'post',
    form: {
      grant_type: 'authorization_code',
      client_id: appInfo.client_id,
      client_secret: appInfo.client_secret,
      redirect_uri: appInfo.redirect_uri,
      code: config.get('authCode')
    },
    json: true
  }).then(res => {
    // debug response info
    debug(`getAccessToken => ${typeof res}: ${res}`)

    return res
  }).catch(err => {
    console.error(`getAccessToken => ${err.code}`)

    throw err
  })
}

const verifyAccess = () => {
  debug(`verifyAccess with: ${config.get('accessToken')}`)

  return rp({
    uri: 'https://api.monzo.com/ping/whoami',
    headers: {
      'Authorization': `Bearer ${config.get('accessToken')}`
    },
    json: true
  }).then(res => {
    // debug response info
    debug(`verifyAccess => ${typeof res}: ${res}`)

    return res
  }).catch(err => {
    debug(`verifyAccess => ${err.message}`)

    throw err
  })
}

const clientDetails = () => {
  let clientDetailsWindow = new BrowserWindow({
    width: 400,
    height: 600
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  clientDetailsWindow.loadURL(url.format({
    pathname: path.resolve(__dirname, 'app/get-client-info.html'),
    protocol: 'file:',
    slashes: true
  }))

  clientDetailsWindow.on('closed', () => {
    clientDetailsWindow = null

    appInfo.client_id = config.get('client_id')
    appInfo.client_secret = config.get('client_secret')

    if (!checkAccess()) {
      requestAuth()
      return
    }

    verifyAccess().then(res => {
      if (res && 'authenticated' in res && res.authenticated) createWindow()
      else requestAuth()
    }).catch(err => {
      console.error(err.message)
    })
  })
}

app.on('ready', () => {
  debug('ready event')

  if (!(config.has('client_id') && config.has('client_secret'))) {
    config.clear()
    clientDetails()
    return
  }

  if (!checkAccess()) {
    requestAuth()
    return
  }

  verifyAccess().then(res => {
    if (res && 'authenticated' in res && res.authenticated) createWindow()
    else requestAuth()
  }).catch(err => {
    console.error(err.message)
  })
})

app.on('open-url', function (ev, forwardedUrl) {
  debug('open-url event')

  authWindow.close()

  const query = url.parse(forwardedUrl).query
  const authResponse = querystring.parse(query)

  debug(`authResponse code => ${authResponse.code}`)

  config.set('authCode', authResponse.code)

  getAccessToken(authResponse)
    .then(res => {
      config.set({
        accessToken: res.access_token,
        authExpires: res.expires_in * 1000,
        authTime: +new Date()
      })
    })
    .then(verifyAccess)
    .then(res => {
      debug(`open-url event => verifyAccess.then => ${res}`)

      createWindow()
    })
})

app.on('window-all-closed', () => {
  debug('window-all-closed event')

  // conflicts with auth strategy
  // if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  debug('activate event')
  if (!mainWindow) createWindow()
})

// updater.check((err, status) => {
//   if (!err && status) updater.download()
// })
//
// updater.on('update-downloaded', info => {
//   updater.install()
// })
