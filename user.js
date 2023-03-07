// ==UserScript==
// @name         PDF to Scrapbox user.js
// @namespace    http://tampermonkey.net/
// @version      11.0.0
// @description  /api/upload/を補足するように処理追加
// @author       You
// @match        https://note.gosyujin.com/pdftoscrapbox/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// ==/UserScript==

const GM_get = (url)=>{
    return new Promise((r)=>{
        const method = "GET";
        const onload = (res)=> r(res);
        GM_xmlhttpRequest({ method, url, onload,withCredentials: true });
    });
}

const GM_save = (title, text) => {
    //const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([ text.join('\n') ], { "type" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const args = { url: url, name: `${title}.txt`, saveAs: false };

    GM_download(args);
}

// index.htmlの要素
const file = document.querySelector('#getfile');
const filespan = document.querySelector('span.file');
const page_per = document.querySelector('span.page_per');
const progress_log = document.querySelector('span.progress_log');
const error_log = document.querySelector('pre.error_log');
const preview = document.querySelector('span.preview');

(function() {
    const read = (file) => {
        return new Promise((r)=>{
            const reader = new FileReader();
            reader.onload = (e)=>{
                r(e.target.result);
            };
            reader.readAsArrayBuffer(file)
        });
    }

    // レンダリング後、Gyazoにアップロード
    const renderAndUpload = async (page, name)=>{
        // see: https://www.linkcom.com/blog/2020/05/pdfjs-resolution.html
        const PRINT_UNITS = 600 / 72.0;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const transform = [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0];
        const viewport = page.getViewport(1.5);
        const renderContext = {
            canvasContext: context,
            transform: transform,
            viewport: viewport
        };

        canvas.width = Math.floor(viewport.width * PRINT_UNITS);
        canvas.height = Math.floor(viewport.height * PRINT_UNITS);
        canvas.style.width = Math.floor(viewport.width * PRINT_UNITS) + "px";
        canvas.style.height = Math.floor(viewport.height * PRINT_UNITS) + "px";

        await page.render(renderContext);
        const dataUrl = canvas.toDataURL('image/jpeg');
        const client_id =
              'a126a3564372324ac926fadea9b4c724f2734dbd734460233a0539b9a84c6ed3';

        const formData = new FormData();
        formData.append('image_url', dataUrl);
        formData.append('client_id', client_id);
        formData.append('referer_url', location.href);
        formData.append('title', name);

        const response = await fetch('https://upload.gyazo.com/api/upload/easy_auth', { method: 'POST', body: formData });
        const data = await response.json();
        const res = await GM_get(data.get_image_url);
        return res.finalUrl;
    }

    // ファイルを選択時、PDF読み込み開始
    file.addEventListener('change', async (e) => {
        filespan.textContent = '初期化';
        page_per.textContent = '初期化';
        progress_log.textContent = '[]';
        error_log.textContent = '';

        PDFJS.cMapUrl = './cmaps/';
        PDFJS.cMapPacked = true;
        const file = e.srcElement.files[0];
        const obj = await read(file);
        const pdf = await PDFJS.getDocument(obj);

        filespan.textContent = file.name;
        console.info(`${file.name}: ${pdf.numPages} pages`);

        let pages = [];
        let page = 1;
        while(true){
            progress_log.textContent = `[${'|'.repeat(page)}${'-'.repeat(pdf.numPages - page)}]`;
            const i = await pdf.getPage(page);

            let gyazo;

            // とりあえずエラーになっても3回試してみる
            for (let retry = 1; retry <= 3; retry++) {
                try {
                    gyazo = await renderAndUpload(i, file.name);
                } catch (error) {
                    console.error(`error and ${retry} retry: ${error}`);
                    error_log.textContent += `error and ${retry} retry: ${error}\r\n`;
                }
                if (gyazo) {
                    // エラーにならずにGyazoのURLは帰ってきたが、レスポンスが想定したURLと違う場合、もう一回チャレンジしてみる
                    if (gyazo.includes('/api/upload/')) {
                        console.error(`${gyazo}`);
                        error_log.textContent += `${gyazo}\r\n`;
                    } else {
                        break;
                    }
                }
            }

            console.info(`${('0000'+page).slice(-4)}: ${gyazo}`);
            if(pages.includes(gyazo)){
                console.info(`push skip includes: ${gyazo}`);
            } else {
                pages.push(gyazo);
            }
            if(page == pdf.numPages) break;
            page ++;
            page_per.textContent = `${page} / ${pdf.numPages}`;
        }
        const urls = pages.map(url => `[[${url}]]`);
        urls.unshift(file.name.normalize());
        window.open(`https://scrapbox.io/${document.querySelector('input').value}/new?body=${encodeURIComponent(urls.join("\n"))}`);

        const plainUrls = pages.map(url => `${url}`);
        GM_save(file.name.normalize(), plainUrls);
        console.info(`${file.name.normalize()} done.`);
    });
})();
