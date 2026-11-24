import { app, BrowserWindow, shell, Tray, Menu } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

// app.commandLine.appendSwitch('js-flags', '--expose-gc');
app.commandLine.appendSwitch('js-flags', '--expose-gc');

const getLock = app.requestSingleInstanceLock();

if(!getLock) {
    app.quit();
}else{
    app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows().at(0);
        if(win) {
            if(win.isMinimized()) win.restore()
                win.focus();
        }
    })
}



const createWindow = () => {
    const win = new BrowserWindow({
        width: 1580,
        height: 800,
        minWidth: 960,
        minHeight: 600,
        show: false,
        frame: false,
        // backgroundColor: '#ffffff',           // 和页面底色一致，减少视觉跳变
        backgroundColor: '#1e1e1e',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',  // 'hiddenInset' macOS特色标题栏
        webPreferences: {
            preload: join(__dirname, '../preload/preload.js'),
            contextIsolation: true,   // 开启上下文隔离
            nodeIntegration: false,    // 关闭node集成
            sandbox: false,           // 额外建议：启用 Chromium 沙箱
            webSecurity: true,
            additionalArguments: ['--expose-gc'],
            // 禁用 WebGL（除非用 Three.js）
            webgl: false,
            // 禁用 PDF 查看器（减少内存占用）
            plugins: false,
        }
    });

    win.once('ready-to-show', () => win.show());

    win.webContents.setWindowOpenHandler(({ url }: {url:string}) => {
        shell.openExternal(url);
        return {'action':'deny'}
    });

    
    win.loadFile(join(__dirname, '../dist/index.html'))

    win.webContents.openDevTools({mode: 'detach'});


    const icon = '';
    const tray = new Tray(icon)

    const contextMenu = [
        {
        label: '退出',
        click: function () {
            app.exit()
        }
        }
    ]

    const menu = Menu.buildFromTemplate(contextMenu)
    tray.setToolTip('EC编程俱乐部')
    tray.setContextMenu(menu)
    tray.on('click', () => {
        // 使窗口显示在任务栏中
        win.setSkipTaskbar(false)
        win.show()
    })

}

app.whenReady().then(() => {
    createWindow();
    
    app.on('activate', ()=>{
        if(BrowserWindow.getAllWindows().length === 0) createWindow();
    })
}).catch((err) => {
    console.log(err)
})

app.on('window-all-closed', () => {
    if(process.platform !== 'darwin') app.quit();
})



