import fetch, { Headers, Response } from "node-fetch";
import { parse } from "node-html-parser";
import { pipeline } from "stream";
import { promisify } from "util";
import fs from "fs";

interface IOsPlaylistItem {
  title: string;
  url: string;
  image: string;
}

async function saveFile(body: NodeJS.ReadableStream, filename: string) {
  const writer = fs.createWriteStream(filename);
  let success = true;
  writer.on("error", () => {
    success = false;
    fs.existsSync(filename) && fs.unlinkSync(filename);
  });
  await promisify(pipeline)(body, writer).catch((e) => e && (success = false));
  return success;
}

export class OsAnime {
  name: string;
  url: string;
  headers: Headers;
  constructor() {
    this.name = "OS Anime";
    this.url = "https://osanime.com";
    this.headers = new Headers({
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
      referer: "https://osanime.com/",
    });
  }

  async list(page: string, sort = "newest") {
    const SORTING: { [key: string]: string } = {
      newest: "idl",
      asc: "nl",
      desc: "n",
    };

    sort = SORTING[sort] ?? "idl";
    const ostPageUrl = `${this.url}/page-lists/1/Ost-Anime/${sort}/${
      page || 1
    }`;
    const response = await fetch(ostPageUrl, {
      headers: this.headers,
    }).catch((e) => {
      console.log(e);
    });
    if (!response || !response.ok) return null;
    const html = await response.text();
    return this.listParser(html);
  }

  listParser(html: string): IOsPlaylistItem[] {
    const soup = parse(html);
    const article = soup.querySelector("article");
    if (!article) return [];
    const items = article.querySelectorAll("a"); //, { rel: "bookmark" }
    const itemsJson: IOsPlaylistItem[] = [];

    items.map((item) => {
      const title = item.attrs["title"];
      const image = item.querySelector("img");
      if (!title || !image) return;

      itemsJson.push({
        title: item.attrs["title"],
        url: item.attrs["href"],
        image: `https${image.attrs["src"]}`,
      });
    });

    return itemsJson;
  }

  getIdFromUrl(url: string) {
    return url.replace("https://osanime.com/site-down.html?to-file=", "");
  }

  async getMusicInfo(url: string) {
    const id = this.getIdFromUrl(url);
    const musicUrl = `https://osanime.com/site-down.html?to-file=${id}`;
    console.log(musicUrl, id);
    const response = await fetch(musicUrl, {
      headers: this.headers,
    }).catch((e) => console.log(e));
    if (!response || !response.ok) return null;
    const html = await response.text();
    const soup = parse(html);
    const source = soup.querySelector("source");
    if (!source) return null;
    const { osanime_com: session } = this.cookieParser(response);

    return {
      source: `https:${source.attrs.src.toString()}`,
      session: session,
    };
  }

  async getRedirect(url: string) {
    const res = await fetch(url, {
      method: "head",
    });
    return res?.url;
  }

  async getMusicResponse(url: string) {
    const info = await this.getMusicInfo(url);
    if (!info) return null;
    const { source, session } = info;
    const response = await fetch(source, {
      headers: new Headers({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/104.0.0.0 Safari/537.36",
        referer: url,
        range: "bytes=0-",
        "accept-encoding": "identity;q=1, *;q=0",
        Connection: "keep-alive",
        cookie: `osanime_com=${session}`,
      }),
    }).catch((e) => console.log(e));
    return response;
  }

  async getRedirectUrl(url: string) {}

  async downloader(url: string, filename: string) {
    if (fs.existsSync(filename)) return filename;
    const response = await this.getMusicResponse(url);
    if (!response || response.status !== 206 || response.body === null)
      return null;
    console.log(`Status ${response.status} | Downloading ${filename}`);
    await saveFile(response.body, filename);
    return filename;
  }

  cookieParser(response: Response) {
    const raw = response.headers.get("set-cookie");
    if (!raw) return {};
    const cookies: { [key: string]: string } = {};

    raw.split("; ").map((entry: string) => {
      const split = entry.split("=");
      const name = split[0];
      const value = split[1];
      cookies[name] = value;
    });

    return cookies;
  }
}

async function ostDownloader() {
  const o = new OsAnime();
  let page = 1;
  const songList: IOsPlaylistItem[] = [];

  while (true) {
    console.log(`Page: ${page} | Total: ${songList.length}`);
    const items = await o.list(page.toString());
    if (!items) break;
    songList.push.apply(songList, items);
    page++;
  }

  fs.writeFileSync("./anime-ost-list.json", JSON.stringify(songList));
  console.log("finished!");
  console.log(`Total: ${songList.length}`);
}

async function ostDownloaderMulti(limit = 10) {
  const o = new OsAnime();
  let page = 1;
  const limitFetch = limit;
  const songList: IOsPlaylistItem[] = [];
  let totalPerMultiFetch = 1;

  while (totalPerMultiFetch) {
    console.log(
      `Page: ${page}-${page + limitFetch} | Total: ${songList.length}`
    );

    await Promise.all(
      [...Array(limitFetch)].map((_, i) => o.list((page + i).toString()))
    ).then((responses) => {
      const newList: IOsPlaylistItem[] = [];

      responses.map((item) => {
        item && newList.push.apply(newList, item);
      });

      songList.push.apply(songList, newList);
      totalPerMultiFetch = newList.length;
    });

    page += limitFetch;
  }

  fs.writeFileSync("./anime-ost-list.json", JSON.stringify(songList));
  console.log("finished!");
  console.log(`Total: ${songList.length}`);
}

export { IOsPlaylistItem };