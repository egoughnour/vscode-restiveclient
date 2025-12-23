import { DOMParser, XMLSerializer } from 'xmldom';
import * as xpath from 'xpath';
import { VariableResolver } from './jsonPathBodyPatcher';

export interface XmlPatchRule {
    path: string;
    rawValue: string;
}

export async function applyXPathPokes(
    xmlText: string,
    rules: XmlPatchRule[],
    resolveVariables: VariableResolver
): Promise<string> {
    if (!rules.length) {
        return xmlText;
    }

    const parser = new DOMParser({
        errorHandler: {
            warning: () => undefined,
            error: (msg: string) => {
                throw new Error(`REST Client XML patch: body is not valid XML: ${msg}`);
            },
            fatalError: (msg: string) => {
                throw new Error(`REST Client XML patch: body is not valid XML: ${msg}`);
            }
        }
    });
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (!doc || !doc.documentElement) {
        throw new Error('REST Client XML patch: unable to parse XML body');
    }

    for (const rule of rules) {
        const resolvedText = await resolveVariables(rule.rawValue);
        const nodes = xpath.select(rule.path, doc) as xpath.SelectedValue[];
        if (!Array.isArray(nodes) || nodes.length === 0) {
            continue;
        }
        for (const node of nodes) {
            applyValueToNode(node, resolvedText, doc);
        }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
}

function applyValueToNode(node: xpath.SelectedValue, value: string, doc: any): void {
    const casted: any = node as any;
    if (casted.nodeType === 2) { // ATTRIBUTE_NODE
        casted.value = value;
        return;
    }

    if (casted.nodeType === 3) { // TEXT_NODE
        casted.data = value;
        return;
    }

    // Element or other node types
    while (casted.firstChild) {
        casted.removeChild(casted.firstChild);
    }
    casted.appendChild(doc.createTextNode(value));
}
