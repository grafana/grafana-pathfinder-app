"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectUnknownFields = detectUnknownFields;
/**
 * Unknown field detection for forward compatibility
 */
const json_guide_schema_1 = require("../types/json-guide.schema");
function checkUnknownFields(obj, knownFields, path) {
    const warnings = [];
    for (const key of Object.keys(obj)) {
        if (!knownFields.has(key)) {
            warnings.push({ message: `Unknown field '${key}' at ${formatPath(path)}`, path: [...path, key], type: 'unknown-field' });
        }
    }
    return warnings;
}
function formatPath(path) {
    if (path.length === 0)
        return 'root';
    return path.map(p => typeof p === 'number' ? `[${p}]` : `.${p}`).join('');
}
function detectUnknownFieldsInBlock(block, path) {
    const warnings = [];
    const blockType = block.type;
    const knownFields = json_guide_schema_1.KNOWN_FIELDS[blockType];
    if (!knownFields)
        return warnings;
    warnings.push(...checkUnknownFields(block, knownFields, path));
    if (Array.isArray(block.blocks)) {
        block.blocks.forEach((nestedBlock, index) => {
            warnings.push(...detectUnknownFieldsInBlock(nestedBlock, [...path, 'blocks', index]));
        });
    }
    if (Array.isArray(block.steps)) {
        const stepFields = json_guide_schema_1.KNOWN_FIELDS._step;
        if (stepFields) {
            block.steps.forEach((step, index) => {
                warnings.push(...checkUnknownFields(step, stepFields, [...path, 'steps', index]));
            });
        }
    }
    if (Array.isArray(block.choices)) {
        const choiceFields = json_guide_schema_1.KNOWN_FIELDS._choice;
        if (choiceFields) {
            block.choices.forEach((choice, index) => {
                warnings.push(...checkUnknownFields(choice, choiceFields, [...path, 'choices', index]));
            });
        }
    }
    return warnings;
}
function detectUnknownFields(guide) {
    if (!guide || typeof guide !== 'object')
        return [];
    const warnings = [];
    const guideObj = guide;
    const guideFields = json_guide_schema_1.KNOWN_FIELDS._guide;
    if (guideFields)
        warnings.push(...checkUnknownFields(guideObj, guideFields, []));
    if (guideObj.match && typeof guideObj.match === 'object') {
        const matchFields = json_guide_schema_1.KNOWN_FIELDS._match;
        if (matchFields)
            warnings.push(...checkUnknownFields(guideObj.match, matchFields, ['match']));
    }
    if (Array.isArray(guideObj.blocks)) {
        guideObj.blocks.forEach((block, index) => {
            warnings.push(...detectUnknownFieldsInBlock(block, ['blocks', index]));
        });
    }
    return warnings;
}
