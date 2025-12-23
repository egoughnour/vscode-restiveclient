import { strict as assert } from 'assert';
import { applyXPathPokes, XmlPatchRule } from '../src/utils/xmlBodyPatcher';

describe('xmlBodyPatcher', () => {
    describe('applyXPathPokes', () => {
        const identity = async (text: string) => text;

        it('returns original XML when no rules provided', async () => {
            const xml = '<root><name>Original</name></root>';
            const result = await applyXPathPokes(xml, [], identity);
            assert.ok(result.includes('<name>Original</name>'));
        });

        it('updates text content of an element', async () => {
            const xml = '<root><name>Original</name></root>';
            const rules: XmlPatchRule[] = [{ path: '//name', rawValue: 'Updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<name>Updated</name>'));
        });

        it('updates an attribute value', async () => {
            const xml = '<user status="inactive"><name>John</name></user>';
            const rules: XmlPatchRule[] = [{ path: '//user/@status', rawValue: 'active' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('status="active"'));
        });

        it('updates multiple elements matching XPath', async () => {
            const xml = '<users><user><name>A</name></user><user><name>B</name></user></users>';
            const rules: XmlPatchRule[] = [{ path: '//user/name', rawValue: 'Updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            const matches = result.match(/<name>Updated<\/name>/g);
            assert.equal(matches?.length, 2);
        });

        it('updates deeply nested elements', async () => {
            const xml = '<root><level1><level2><level3><value>original</value></level3></level2></level1></root>';
            const rules: XmlPatchRule[] = [{ path: '//level3/value', rawValue: 'deep-update' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<value>deep-update</value>'));
        });

        it('handles multiple rules', async () => {
            const xml = '<root><name>Original</name><status>pending</status></root>';
            const rules: XmlPatchRule[] = [
                { path: '//name', rawValue: 'NewName' },
                { path: '//status', rawValue: 'complete' }
            ];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<name>NewName</name>'));
            assert.ok(result.includes('<status>complete</status>'));
        });

        it('uses variable resolver for values', async () => {
            const xml = '<root><token>placeholder</token></root>';
            const rules: XmlPatchRule[] = [{ path: '//token', rawValue: '{{secret}}' }];
            const resolver = async (text: string) => {
                if (text === '{{secret}}') return 'resolved-secret';
                return text;
            };
            const result = await applyXPathPokes(xml, rules, resolver);
            assert.ok(result.includes('<token>resolved-secret</token>'));
        });

        it('handles XPath predicates', async () => {
            const xml = '<users><user id="1"><name>Alice</name></user><user id="2"><name>Bob</name></user></users>';
            const rules: XmlPatchRule[] = [{ path: '//user[@id="2"]/name', rawValue: 'Robert' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<name>Alice</name>'));
            assert.ok(result.includes('<name>Robert</name>'));
        });

        it('handles positional XPath expressions', async () => {
            const xml = '<items><item>First</item><item>Second</item><item>Third</item></items>';
            const rules: XmlPatchRule[] = [{ path: '//item[2]', rawValue: 'Updated Second' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<item>First</item>'));
            assert.ok(result.includes('<item>Updated Second</item>'));
            assert.ok(result.includes('<item>Third</item>'));
        });

        it('replaces element content entirely', async () => {
            const xml = '<root><data>Old <nested>content</nested> here</data></root>';
            const rules: XmlPatchRule[] = [{ path: '//data', rawValue: 'New content' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<data>New content</data>'));
            assert.ok(!result.includes('<nested>'));
        });

        it('does nothing when XPath matches no elements', async () => {
            const xml = '<root><existing>value</existing></root>';
            const rules: XmlPatchRule[] = [{ path: '//nonexistent', rawValue: 'new' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<existing>value</existing>'));
        });

        it('handles XML with namespaces (default namespace)', async () => {
            const xml = '<root xmlns="http://example.com"><name>Original</name></root>';
            const rules: XmlPatchRule[] = [{ path: '//*[local-name()="name"]', rawValue: 'Updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('>Updated</'));
        });

        it('handles XML declaration', async () => {
            const xml = '<?xml version="1.0" encoding="UTF-8"?><root><name>Original</name></root>';
            const rules: XmlPatchRule[] = [{ path: '//name', rawValue: 'Updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<name>Updated</name>'));
        });

        it('handles CDATA sections by replacing with text', async () => {
            const xml = '<root><data><![CDATA[original content]]></data></root>';
            const rules: XmlPatchRule[] = [{ path: '//data', rawValue: 'new content' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('new content'));
        });

        it('preserves other elements when patching specific ones', async () => {
            const xml = '<root><a>1</a><b>2</b><c>3</c></root>';
            const rules: XmlPatchRule[] = [{ path: '//b', rawValue: 'updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<a>1</a>'));
            assert.ok(result.includes('<b>updated</b>'));
            assert.ok(result.includes('<c>3</c>'));
        });

        it('handles special XML characters in replacement value', async () => {
            const xml = '<root><data>original</data></root>';
            const rules: XmlPatchRule[] = [{ path: '//data', rawValue: 'Value with <special> & "chars"' }];
            const result = await applyXPathPokes(xml, rules, identity);
            // The value should be properly escaped or included as text
            assert.ok(result.includes('<data>'));
            assert.ok(result.includes('</data>'));
        });

        it('throws error for invalid XML input', async () => {
            const invalidXml = '<not valid xml';
            const rules: XmlPatchRule[] = [{ path: '//name', rawValue: 'value' }];
            await assert.rejects(
                async () => applyXPathPokes(invalidXml, rules, identity),
                /body is not valid XML|unable to parse XML/
            );
        });

        it('handles self-closing tags', async () => {
            const xml = '<root><item/><data>value</data></root>';
            const rules: XmlPatchRule[] = [{ path: '//data', rawValue: 'updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<data>updated</data>'));
        });

        it('handles text nodes directly', async () => {
            const xml = '<root>Text content</root>';
            const rules: XmlPatchRule[] = [{ path: '//root/text()', rawValue: 'New text' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('New text'));
        });

        it('handles async variable resolution', async () => {
            const xml = '<root><token>placeholder</token></root>';
            const rules: XmlPatchRule[] = [{ path: '//token', rawValue: '{{async-var}}' }];
            const resolver = async (text: string) => {
                await new Promise(resolve => setTimeout(resolve, 10));
                if (text === '{{async-var}}') return 'async-resolved';
                return text;
            };
            const result = await applyXPathPokes(xml, rules, resolver);
            assert.ok(result.includes('<token>async-resolved</token>'));
        });

        it('handles multiple attributes on same element', async () => {
            const xml = '<user id="123" status="pending" role="user"><name>Test</name></user>';
            const rules: XmlPatchRule[] = [
                { path: '//user/@status', rawValue: 'active' },
                { path: '//user/@role', rawValue: 'admin' }
            ];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('status="active"'));
            assert.ok(result.includes('role="admin"'));
            assert.ok(result.includes('id="123"'));
        });

        it('handles root element selection', async () => {
            const xml = '<root><child>data</child></root>';
            const rules: XmlPatchRule[] = [{ path: '/root/child', rawValue: 'updated' }];
            const result = await applyXPathPokes(xml, rules, identity);
            assert.ok(result.includes('<child>updated</child>'));
        });
    });
});
