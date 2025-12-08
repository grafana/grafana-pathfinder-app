"use strict";
/**
 * JSON Guide Type Definitions
 *
 * Structured format for interactive guides that converts to ParsedElement[]
 * for rendering through the existing content pipeline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMarkdownBlock = isMarkdownBlock;
exports.isHtmlBlock = isHtmlBlock;
exports.isSectionBlock = isSectionBlock;
exports.isInteractiveBlock = isInteractiveBlock;
exports.isMultistepBlock = isMultistepBlock;
exports.isGuidedBlock = isGuidedBlock;
exports.isImageBlock = isImageBlock;
exports.isVideoBlock = isVideoBlock;
exports.isQuizBlock = isQuizBlock;
exports.isAssistantBlock = isAssistantBlock;
// ============ TYPE GUARDS ============
/**
 * Type guard for JsonMarkdownBlock
 */
function isMarkdownBlock(block) {
    return block.type === 'markdown';
}
/**
 * Type guard for JsonHtmlBlock
 */
function isHtmlBlock(block) {
    return block.type === 'html';
}
/**
 * Type guard for JsonSectionBlock
 */
function isSectionBlock(block) {
    return block.type === 'section';
}
/**
 * Type guard for JsonInteractiveBlock
 */
function isInteractiveBlock(block) {
    return block.type === 'interactive';
}
/**
 * Type guard for JsonMultistepBlock
 */
function isMultistepBlock(block) {
    return block.type === 'multistep';
}
/**
 * Type guard for JsonGuidedBlock
 */
function isGuidedBlock(block) {
    return block.type === 'guided';
}
/**
 * Type guard for JsonImageBlock
 */
function isImageBlock(block) {
    return block.type === 'image';
}
/**
 * Type guard for JsonVideoBlock
 */
function isVideoBlock(block) {
    return block.type === 'video';
}
/**
 * Type guard for JsonQuizBlock
 */
function isQuizBlock(block) {
    return block.type === 'quiz';
}
/**
 * Type guard for JsonAssistantBlock
 */
function isAssistantBlock(block) {
    return block.type === 'assistant';
}
