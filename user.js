// ==UserScript==
// @name         PDF to Scrapbox user.js
// @namespace    http://tampermonkey.net/
// @version      10.0.0
// @description  レンダリング解像度を変更
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

const file = document.querySelector('#getfile');
const drop = document.querySelector('#drop');
const filespan = document.querySelector('span.file');
const page_per = document.querySelector('span.page_per');

// ファイル選択
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

        //console.log(`PRINT_UNITS:${PRINT_UNITS} width:${canvas.width} height:${canvas.height}`)

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

    file.addEventListener('change', async (e) => {
        console.info(e.srcElement.files[0]);
        PDFJS.cMapUrl = './cmaps/';
        PDFJS.cMapPacked = true;
        const file = e.srcElement.files[0];

        filespan.textContent = '初期化';
        page_per.textContent = '初期化';

        console.info(file);
        filespan.textContent = file.name;

        const obj = await read(file);
        const pdf = await PDFJS.getDocument(obj);

        console.info(pdf.numPages);

        let pages = [];

        let page = 1;
        while(true){
            const i = await pdf.getPage(page);

            let gyazo;

            for (let retry = 1; retry <= 3; retry++) {
                try {
                    gyazo = await renderAndUpload(i, file.name);
                } catch (error) {
                    console.info(`error and ${retry} retry: ${error}`);
                }
                if (gyazo) {
                    break;
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
