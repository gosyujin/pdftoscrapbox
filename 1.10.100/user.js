// ==UserScript==
// @name         PDF to Scrapbox user.js
// @namespace    http://tampermonkey.net/
// @version      20.0.0
// @description  アップロードAPIをeasy_authからuploadに変更
// @author       You
// @match        https://note.gosyujin.com/pdftoscrapbox/*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// ==/UserScript==

const GYAZO_ACCESS_TOKEN = 'YOUR_TOKEN';
const GYAZO_UPLOAD_ENDPOINT = 'https://upload.gyazo.com/api/upload';
const MAX_RETRY = 3;

// index.htmlの要素
const file = document.querySelector('#getfile');
const filespan = document.querySelector('span.file');
const page_per = document.querySelector('span.page_per');
const progress_log = document.querySelector('span.progress_log');
const error_log = document.querySelector('pre.error_log');
const preview = document.querySelector('span.preview');

const debug = (d = {console: null, filespan: null, page_per: null, progress_log: null, error_log: null, preview: null}) => {
    if (d.console) console.log(d.console);
    if (d.filespan) filespan.textContent = d.filespan;
    if (d.page_per) page_per.textContent = d.page_per;
    if (d.progress_log) progress_log.textContent = d.progress_log;
    if (d.error_log) error_log.textContent += `${d.error_log}\r\n`;
}

const GM_post = (blob, referer, title) => {
    const data = new FormData();
    data.append('access_token', GYAZO_ACCESS_TOKEN);
    data.append('imagedata', blob, 'imagedata.jpg');
    data.append('access_policy', 'anyone'); // 'anyone' or 'only_me'
    data.append('metadata_is_public', false);
    data.append('referer_url', referer);
    data.append('app', 'pdf_to_scrapbox');
    data.append('title', title);

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'POST',
            url: GYAZO_UPLOAD_ENDPOINT,
            data: data,
            onload(res) {
                resolve(res);
            },
            withCredentials: true
        });
    });
}

const GM_save = (title, text) => {
    //const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([ text.join('\n') ], { "type" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const args = { url: url, name: `${title}.txt`, saveAs: false };
    GM_download(args);
}

const readPdf = (file) => {
    return new Promise((r) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            r(e.target.result);
        };
        reader.readAsArrayBuffer(file)
    });
}

const canvasToBlob = (dataUrl) => {
    // Base64データをバイナリデータに変換する
    const byteString = atob(dataUrl.split(',')[1]);
    // MIMEタイプを取得する
    const mimeType = dataUrl.split(',')[0].split(':')[1].split(';')[0];
    // バイナリデータを格納する配列を作成する
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uint8Array = new Uint8Array(arrayBuffer);
    // バイナリデータを配列に格納する
    for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
    }
    // Blobオブジェクトを作成する
    const blob = new Blob([arrayBuffer], { type: mimeType });
    return blob;
}

(function() {
    // レンダリング後、Gyazoにアップロード
    const renderAndUpload = async (page, name) => {
        // see: https://www.linkcom.com/blog/2020/05/pdfjs-resolution.html
        const PRINT_UNITS = 600 / 72.0;
        const MAXIMUM_CANVAS_SIZE = 32767;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const transform = [PRINT_UNITS, 0, 0, PRINT_UNITS, 0, 0];
        let viewport = page.getViewport(1.5);
        //FIXME デカすぎる画像のscaleを小さくする方法もうちょっと上手く書ける
        if (viewport.width * PRINT_UNITS > MAXIMUM_CANVAS_SIZE || viewport.height * PRINT_UNITS > MAXIMUM_CANVAS_SIZE) {
            viewport = page.getViewport(0.8);
        }
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

        const blob = await canvasToBlob(canvas.toDataURL('image/jpeg'));
        const response = await GM_post(blob, location.href, name);
        const data = await response.response;
        return JSON.parse(data).permalink_url;
    }

    // ファイルを選択時、PDF読み込み開始
    file.addEventListener('change', async (e) => {
        PDFJS.cMapUrl = './cmaps/';
        PDFJS.cMapPacked = true;
        const file = e.srcElement.files[0];
        const obj = await readPdf(file);
        const pdf = await PDFJS.getDocument(obj);
        let gyazoUrlList = [];
        let currentPageIndex = 1;
        debug({filespan: '初期化', page_per: '初期化', progress_log: '[]', error_log: ''});
        debug({console: `${file.name}: ${pdf.numPages}pages`, filespan: file.name, page_per: `${currentPageIndex} / ${pdf.numPages} (${new Date().toLocaleString()})`, progress_log: `[${'|'.repeat(currentPageIndex)}${'-'.repeat(pdf.numPages - currentPageIndex)}]`});

        while(true) {
            const page = await pdf.getPage(currentPageIndex);
            let gyazo;

            for (let retry = 1; retry <= MAX_RETRY; retry++) {
                try {
                    gyazo = await renderAndUpload(page, file.name);
                } catch (error) {
                    debug({console: `error and ${retry} retry: ${error}`, error_log: `error and ${retry} retry: ${error}`});
                }
                if (gyazo && gyazo.includes('/api/upload/')) {
                    // GyazoのURLは返ってきたが、レスポンスが想定したURLと違う場合ループを継続してみる(なぜか/api/upload/という文字列が入ってくる時がある)
                    debug({console: `なんか変: ${gyazo}`, error_log: `なんか変: ${gyazo}`});
                } else {
                    // GyazoっぽいURLが返ってきたらループ終了を待たずに脱出
                    break;
                }
            }
            if (!gyazo) return;

            if(gyazoUrlList.includes(gyazo)){
                // 同じ画像が既にgyazoUrlListにpushされている場合、そのページは飛ばす
                debug({console: `push skip includes: ${gyazo}`, error_log: `push skip includes: ${gyazo}`});
            } else {
                gyazoUrlList.push(gyazo);
            }

            debug({console: `${('0000'+currentPageIndex).slice(-4)}: ${gyazo}`, page_per: `${currentPageIndex} / ${pdf.numPages} (${new Date().toLocaleString()})`, progress_log: `[${'|'.repeat(currentPageIndex)}${'-'.repeat(pdf.numPages - currentPageIndex)}]`});
            if(currentPageIndex == pdf.numPages) break;
            currentPageIndex++;
        }

        if (gyazoUrlList.length === 0) return;

        // すべてのGyazo URLを[[]]で装飾(Scrapboxページへのwindow.open用)
        const urls = gyazoUrlList.map(url => `[[${url}]]`);
        // 1行目=タイトルをファイル名にしている
        urls.unshift(file.name.normalize());
        window.open(`https://scrapbox.io/${document.querySelector('input').value}/new?body=${encodeURIComponent(urls.join("\n"))}`);

        //　Gyazo URL一覧のファイルダウンロード用
        const plainUrls = gyazoUrlList.map(url => `${url}`);
        GM_save(file.name.normalize(), plainUrls);
    });
})();
