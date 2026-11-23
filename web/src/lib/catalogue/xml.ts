// A small XML reader, enough for the MARC records library catalogues answer with.
// It knows elements, attributes, text, CDATA and the usual entities. A DOCTYPE is
// refused: catalogue answers never need one, and refusing keeps entity tricks out.

export interface XmlElement {
  /** The name without its namespace prefix. */
  name: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** All text inside the element, including that of its children. */
  text: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith("#")) return String.fromCodePoint(parseInt(name.slice(1), 10));
    return ENTITIES[name] ?? whole;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** Parses a document. Returns null for anything that is not well formed XML. */
export function parseXml(xml: string): XmlElement | null {
  const root: XmlElement = { name: "#document", attributes: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  const names: string[] = ["#document"];
  let i = 0;
  const addText = (text: string) => {
    for (const element of stack) element.text += text;
  };
  while (i < xml.length) {
    const open = xml.indexOf("<", i);
    if (open < 0) {
      if (xml.slice(i).trim() !== "" && stack.length === 1) return null;
      addText(decode(xml.slice(i)));
      break;
    }
    if (open > i) {
      const between = xml.slice(i, open);
      // Text outside of any element means this is not XML at all.
      if (stack.length === 1 && between.trim() !== "") return null;
      addText(decode(between));
    }
    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) return null;
      i = end + 3;
    } else if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0) return null;
      addText(xml.slice(open + 9, end));
      i = end + 3;
    } else if (xml.startsWith("<?", open)) {
      const end = xml.indexOf("?>", open + 2);
      if (end < 0) return null;
      i = end + 2;
    } else if (xml.startsWith("<!", open)) {
      return null;
    } else if (xml.startsWith("</", open)) {
      const end = xml.indexOf(">", open);
      if (end < 0) return null;
      const name = xml.slice(open + 2, end).trim();
      if (stack.length < 2 || names[names.length - 1] !== name) return null;
      stack.pop();
      names.pop();
      i = end + 1;
    } else {
      const tag = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(xml.slice(open, open + 4000));
      if (!tag) return null;
      const attributes: Record<string, string> = {};
      for (const match of tag[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attributes[local(match[1])] = decode(match[2] ?? match[3] ?? "");
      }
      const element: XmlElement = { name: local(tag[1]), attributes, children: [], text: "" };
      stack[stack.length - 1].children.push(element);
      if (tag[3] !== "/") {
        stack.push(element);
        names.push(tag[1]);
      }
      i = open + tag[0].length;
    }
  }
  if (stack.length !== 1 || root.children.length !== 1) return null;
  return root.children[0];
}

/** The element itself and everything below it, in the order of the document. */
export function descendants(element: XmlElement): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (current: XmlElement) => {
    out.push(current);
    current.children.forEach(walk);
  };
  walk(element);
  return out;
}
