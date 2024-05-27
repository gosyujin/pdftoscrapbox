// ==UserScript==
// @name         PDF to Scrapbox user.js
// @namespace    http://tampermonkey.net/
// @version      30.0.1
// @description  pdf.js 4.2.67 with cmap
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
const show_log = document.querySelector('pre.show_log');
const preview = document.querySelector('span.preview');

const debug = (d = {console: null, filespan: null, page_per: null, progress_log: null, show_log: null, preview: null}) => {
    if (d.console) console.log(d.console);
    if (d.filespan) filespan.textContent = d.filespan;
    if (d.page_per) page_per.textContent = d.page_per;
    if (d.progress_log) progress_log.textContent = d.progress_log;
    if (d.show_log) show_log.textContent += `${d.show_log}\r\n`;
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
        reader.readAsDataURL(file)
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
    // ファイルを選択時、PDF読み込み開始
    file.addEventListener('change', async (e) => {
        const file = e.srcElement.files[0];
        const obj = await readPdf(file);

        let gyazoUrlList = [];
        debug({filespan: '初期化', page_per: '初期化', progress_log: '[]', show_log: ''});

        pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
        const pdfDoc = await pdfjsLib.getDocument({url: obj, cMapUrl: "./cmaps/"}).promise;
        const pagePromises = [];

        for (let currentPageIndex = 1; currentPageIndex <= pdfDoc.numPages; currentPageIndex++) {
            debug({filespan: file.name, page_per: `${currentPageIndex} / ${pdfDoc.numPages} (${new Date().toLocaleString()})`, progress_log: `[${'|'.repeat(currentPageIndex)}${'-'.repeat(pdfDoc.numPages - currentPageIndex)}]`});
            const page = await pdfDoc.getPage(currentPageIndex);

            const scale = 1.5;
            const viewport = page.getViewport({ scale: scale });

            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };

            await page.render(renderContext).promise;

            const blob = canvasToBlob(canvas.toDataURL('image/jpeg'));
            const data = await GM_post(blob, location.href, name);
            const gyazo = JSON.parse(data.response).permalink_url;

            if (gyazo && gyazo.includes('/api/upload/')) {
                // GyazoのURLは返ってきたが、レスポンスが想定したURLと違う場合ループを継続してみる(なぜか/api/upload/という文字列が入ってくる時がある)
                debug({console: `なんか変: ${gyazo}`, show_log: `なんか変: ${gyazo}`});
            }
            debug({console: `${gyazo}`, page_per: `${currentPageIndex} / ${pdfDoc.numPages} (${new Date().toLocaleString()})`});
            gyazoUrlList.push(gyazo);
        }

        // すべてのGyazo URLを[[]]で装飾(Scrapboxページへのwindow.open用)
        const urls = gyazoUrlList.map(url => `[[${url}]]`);
        // 1行目=タイトルをファイル名にしている
        urls.unshift(file.name.normalize());
        window.open(`https://scrapbox.io/${document.querySelector('input').value}/new?body=${encodeURIComponent(urls.join("\n"))}`);

        // Gyazo URL一覧のファイルダウンロード用
        const plainUrls = gyazoUrlList.map(url => `${url}`);
        GM_save(file.name.normalize(), plainUrls);
    });
})();
