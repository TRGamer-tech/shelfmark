// Who is at the door, decided before the page is painted.
//
// The address of the site itself serves two pages: the front page for a visitor, and
// the shelf for somebody who is signed in. Which one it is has to be known before the
// first paint, or a reader would see the front page flash by on the way to their shelf.
// A small script in the head looks whether this browser remembers a sign-in (or the
// address carries one, from the link of a mail) and writes the answer on the root
// element, where the stylesheet and the page both read it.

import { LEGAL_PATHS } from "./legal.ts";

export type Visitor = "in" | "out";

/** The two addresses of the front page: English, and German. */
export function isHome(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "");
  return path === "" || path === "/de";
}

const listeners = new Set<() => void>();

/** Null on the server, and for as long as nothing has said who is here. */
export function getVisitor(): Visitor | null {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.dataset.visitor;
  return value === "in" || value === "out" ? value : null;
}

/** Called once the browser really knows: the remembered sign-in may have run out. */
export function setVisitor(value: Visitor): void {
  if (getVisitor() === value) return;
  document.documentElement.dataset.visitor = value;
  listeners.forEach((listener) => listener());
}

export function subscribeVisitor(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Which look a page wears: "front" for the pages a visitor sees before signing in (they
 * always look the same), "app" for the library in the reader's own theme.
 */
export function setWorld(world: "front" | "app"): void {
  document.documentElement.dataset.world = world;
}

// The pages whose address says which language they are in.
const ENGLISH = Object.values(LEGAL_PATHS.en);
const GERMAN = Object.values(LEGAL_PATHS.de);
// The pages a visitor meets before signing in. They wear the colours of the front page.
const FRONT = ["/login", "/reset", "/confirmed", ...ENGLISH, ...GERMAN];

/**
 * Runs before the page is painted. Kept free of anything that could fail loudly: with
 * no answer the stylesheet shows the front page, which is right for a visitor.
 *
 * - "js" on the root element: parts of the front page fold away when a script can unfold them.
 * - data-visitor on the front page: "in" hides it and shows the quiet first screen of the library.
 * - data-world: the colours of the first paint. Somebody who arrives through the link of
 *   a mail is on their way to one of the front pages, so the quiet screen wears their colours.
 * - A reader whose language is German is taken from the English front page to the
 *   German one, unless they chose English, or a sign-in is on its way in.
 * - The imprint and the privacy notice are in the language of their address.
 */
export const VISITOR_SCRIPT = `try{var d=document.documentElement,l=location,p=l.pathname.replace(/\\/+$/,"")||"/";d.classList.add("js");var h=p==="/"||p==="/de",s=!1,g=null;try{s=!!localStorage.getItem("shelfmark.auth");g=localStorage.getItem("shelfmark.lang")}catch(e){}var k=/(^#|&)(access_token|error|error_code|error_description|message)=/.test(l.hash)||/[?&](error|error_code|error_description)=/.test(l.search),i=s||k;if(g!=="en"&&g!=="de")g=/^de/i.test(navigator.language||"")?"de":"en";if(${JSON.stringify(ENGLISH)}.indexOf(p)>=0)g="en";if(${JSON.stringify(GERMAN)}.indexOf(p)>=0)g="de";if(h){d.setAttribute("data-visitor",i?"in":"out");if(!i){if(p==="/"&&g==="de")l.replace("/de"+l.search+l.hash);g=p==="/de"?"de":"en"}}d.setAttribute("data-world",(h&&!i)||k||${JSON.stringify(FRONT)}.indexOf(p)>=0?"front":"app");d.lang=g}catch(e){}`;
