// ==UserScript==
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @name         PDF to Scrapbox user.js
// @namespace    http://tampermonkey.net/
// @version      7.0.0
// @description  アップロードした画像のurlをテキストで保存
// @author       You
// @match        https://note.gosyujin.com/pdftoscrapbox/*
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

(function() {
    window.addEventListener('load', ()=>{
        const drop = document.querySelector('#drop');
        const filespan = document.querySelector('span.file');
        const page_per = document.querySelector('span.page_per');
        const log = document.querySelector('li.log');

        const read = (file)=>{
            return new Promise((r)=>{
                const reader = new FileReader();
                reader.onload = (e)=>{
                    r(e.target.result);
                };
                reader.readAsArrayBuffer(file)
            });
        }

        drop.addEventListener('dragover', (event)=> event.preventDefault());

        const renderAndUpload = async (page, name)=>{
            const viewport = page.getViewport(1.5);
            const canvas = document.createElement('canvas') , ctx = canvas.getContext('2d');
            const renderContext = { canvasContext: ctx, viewport: viewport };

            canvas.height = viewport.height;
            canvas.width = viewport.width;

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

        drop.addEventListener('drop', async (e)=>{
            e.preventDefault();
            PDFJS.cMapUrl = './cmaps/';
            PDFJS.cMapPacked = true;
            const file = event.dataTransfer.files[0];

            filespan.textContent = '初期化';
            page_per.textContent = '初期化';
            log.textContent = '';

            console.log(file);
            filespan.textContent = file.name;

            const obj = await read(file);
            const pdf = await PDFJS.getDocument(obj);

            console.log(pdf.numPages);

            pages = [];

            page = 1;
            while(true){
                const i = await pdf.getPage(page);

                let gyazo;

                for (let retry = 1; retry <= 3; retry++) {
                    try {
                        gyazo = await renderAndUpload(i, file.name);
                    } catch (error) {
                        console.log(`error and ${retry} retry: ${error}`);
                        log.innerHTML += `error and ${retry} retry: ${error}<br />`;
                    }
                    if (gyazo) {
                        break;
                    }
                }

                console.log(`${('0000'+page).slice(-4)}: ${gyazo}`);
                log.innerHTML += `${('0000'+page).slice(-4)}: ${gyazo}<br />`;
                if(pages.includes(gyazo)){
                    console.log(`push skip includes: ${gyazo}`);
                    log.innerHTML += `push skip includes: ${gyazo}<br />`;
                } else {
                    pages.push(gyazo);
                }
                if(page == pdf.numPages) break;
                page ++;
                page_per.textContent = `${page} / ${pdf.numPages}`;
            }
            const urls = pages.map(url => `[[${url}]]`);
            urls.unshift(file.name);
            window.open(`https://scrapbox.io/${document.querySelector('input').value}/new?body=${encodeURIComponent(urls.join("\n"))}`);

            const plainUrls = pages.map(url => `${url}`);
            GM_save(file.name, plainUrls);
        });
    });
})();
