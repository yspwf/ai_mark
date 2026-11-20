// // const fs = require('fs');
// // const path = require('path');
// import fs from 'node:fs';
// import path from 'node:path';
// const outputDirectory = 'result'; // 替换成你的目标文件夹路径
// if(!fs.existsSync(outputDirectory)){
//     fs.mkdirSync(outputDirectory)
// }

// // 根目录，包含多个文件夹
// const rootDirectory = './dist'; // 替换成你的根目录路径

// // 获取根目录下的所有文件夹
// const folders = fs.readdirSync(rootDirectory);

// // 遍历每个文件夹
// folders.forEach(folderName => {
//    const folderPath = path.join(rootDirectory, folderName);
// //    const containerName = 'test';
//    // 检查是否为文件夹
//     if (fs.statSync(folderPath).isDirectory()) {
//         // 查找文件夹中的文件
//         const files = fs.readdirSync(folderPath);
//         // 遍历文件夹中的文件
//         files.forEach(fileName => {
//             // 检查文件名是否包含 "test"
//             // if (fileName.includes(containerName)) {
//                 // 构建新文件的路径和名称
//                 const newFileName = `${folderName}${path.extname(fileName)}`;
//                 const newFilePath = path.join(outputDirectory, newFileName);
//                 // 复制文件到目标文件夹
//                 fs.copyFileSync(path.join(rootDirectory, path.join(folderName,fileName)), newFilePath);
//                 console.log(`Copied ${folderPath}${fileName} to ${newFilePath}`);
//             // }
//         });
//   }
// });



// const glob = require('glob')

import path from 'node:path';
import { cp, rm } from 'node:fs/promises';

import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function moveDir(src, dist) {
    // 清理旧目标；必须在复制前进行。
    await rm(dist, { recursive: true, force: true });

    // cp 会递归创建目标目录，并在 Promise 完成时保证所有文件写入完毕。
    await cp(src, dist, { recursive: true, force: true });

    // 复制成功后才删除源目录，避免失败时丢失构建产物。
    await rm(src, { recursive: true, force: true });
}

const targetDirectory = 'dist-electron/dist';

// 1. 获取当前命令所在目录
const dirPath = process.cwd();

// if (fileList.some((element) => element === answers.name)) {
//    console.log(`当前目录下存在同名文件夹\n`)
//    console.log(`创建失败\n`)
// } else {
   // 3. 如果没有，创建文件夹
   try {
    //    fs.mkdirSync(`${dirPath}${answers.name}`)
       
    //    fs.mkdirSync(`${dirPath}/${targetDirectory}`)
    //    console.log(logSymbols.success, `目录创建成功\n`)

       // 4. 创建好文件夹后，复制本地模板到创建的目标文件夹
       // __dirname：返回运行文件所在的目录 E:\dbt\cli-tool\bin
    //    const dirName = __dirname.split('')
    //    // 目的是为了删除目录中的\bin部分
    //    dirName.splice(-4, 4)
    //    const resultDirName = dirName.join('')

       // 5. 复制目标文件夹内容，copyDir()方法执行文件夹的拷贝
    //    copyDir(path.join(resultDirName, 'packages'), path.join(dirPath, answers.name), (err) => {
    //        if (err) {
    //            console.log('模板下载失败')
    //        } 
    //    })
    // const resultDirName = path.join(__dirname, '.');
    // console.log("resultDirName========", resultDirName)
    await moveDir(
        path.join(__dirname, 'dist'),
        path.join(dirPath, targetDirectory),
    );
    console.log('构建产物已移动到 dist-electron/dist');
   
   } catch (err) {
    console.log(err)
    //    console.log(logSymbols.error, chalk.green("目录创建失败"))
   }
// }
