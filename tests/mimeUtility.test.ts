import { strict as assert } from 'assert';
import { MimeUtility } from '../src/utils/mimeUtility';

describe('MimeUtility.isJSON', () => {
    it('returns true for application/json-patch+json', () => {
        assert.equal(MimeUtility.isJSON('application/json-patch+json'), true);
    });
});
