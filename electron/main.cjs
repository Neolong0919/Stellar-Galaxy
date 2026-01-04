const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// Main process entry


let mainWindow;
let apiProcess;

const isDev = !app.isPackaged; // Simple way to check if we are in dev or prod

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: false, // Sometimes needed for local API calls if CORS is an issue, though avoiding it is better
        },
        autoHideMenuBar: true,
    });

    if (isDev) {
        // In development, load the local Vite server
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        // In production, load the built index.html
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }
}

const { dialog } = require('electron');

function startApiServer() {
    console.log('Starting Netease API Server...');

    // 1. Determine paths
    const apiPath = isDev
        ? path.join(__dirname, '../NeteaseCloudMusicApi')
        : path.join(process.resourcesPath, 'NeteaseCloudMusicApi');

    const scriptPath = path.join(apiPath, 'app.js');

    // 2. Determine Node executable and arguments
    let executable = 'node';
    let args = ['app.js'];

    if (!isDev) {
        // In production, we use the bundled app.exe
        const bundledAppPath = path.join(apiPath, 'app.exe');
        executable = bundledAppPath;
        args = []; // app.exe is the entry point itself
    }

    console.log(`API Path: ${apiPath}`);
    console.log(`Executable: ${executable}`);

    try {
        // 3. Spawn the process
        apiProcess = spawn(executable, args, {
            cwd: apiPath,
            env: { ...process.env, PORT: '4000' },
            shell: false,
            windowsHide: true
        });

        apiProcess.stdout.on('data', (data) => {
            console.log(`API: ${data}`);
        });

        const fs = require('fs');
        const logPath = path.join(isDev ? __dirname : path.dirname(process.execPath), 'backend_error.log');

        apiProcess.stderr.on('data', (data) => {
            console.error(`API Error: ${data}`);
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] STDERR: ${data}\n`);
        });

        // Also log stdout to see if it even starts
        apiProcess.stdout.on('data', (data) => {
            fs.appendFileSync(logPath, `[${new Date().toISOString()}] STDOUT: ${data}\n`);
        });

        apiProcess.on('error', (err) => {
            console.error('API Process Failed to Start:', err);
            dialog.showErrorBox('Backend Error', `Failed to start music component.\n\nPath: ${nodeExecutable}\nError: ${err.message}`);
        });

        apiProcess.on('close', (code) => {
            console.log(`API process exited with code ${code}`);
            if (code !== 0 && code !== null) {
                dialog.showErrorBox('Backend Crashed', `Music component exited unexpectedly with code ${code}.\n\nPlease check if port 4000 is occupied or if there are missing dependencies.`);
            }
        });
    } catch (err) {
        console.error('Failed to spawn API process:', err);
        dialog.showErrorBox('Critical Error', `Could not spawn backend process.\n${err.message}`);
    }
}

app.whenReady().then(() => {
    startApiServer();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Kill the API process when the app quits
    if (apiProcess) {
        apiProcess.kill();
    }
});
