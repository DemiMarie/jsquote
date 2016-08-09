"use strict";
const fs = require('fs');
const acorn = require('acorn');
const process = require('process');
const assert = require('assert');
const tokTypes = acorn.tokTypes;

// Escape the sequences that are special in HTML and XML.
function escapeToken(input) {
    let escapedSome = input.replace('<!--', '\\x3c!--');
    let escapedABitMore = escapedSome.replace('-->', '-\\x2d>');
    // '\x3c' = '<'
    let escapedStillMore = escapedABitMore.replace('<script', '\\x3cscript');
    // must not escape the '/', as that could be the end of a regex
    // This ensures pedantic compliance with not just HTML5, but HTML4 and
    // earlier, in which </ unconditionally ended a <script></script> block
    let escapedEvenMore = escapedStillMore.replace('</', '\\x3c/');
    return escapedEvenMore.replace(']]>', ']\\x5d>');
}
// Escape the sequences ]]> and -->, which are special
// in XML and HTML respectively.
function handleLeadingGreaterThan(token, input) {
    if (token.start > 1) {
        switch (input.substring(token.start - 2, token.start)) {
        case ']]':
        case '--':
            return ' ' + token.value;
        }
        return token.value;
    }
    return token.value;
}

function processToken(token, input) {
    if (token.value === undefined) {
        return (token.type === tokTypes.eof) ? null : token.type.label;
    }
    switch (token.type) {
    case tokTypes.eof:
        return null;
    case tokTypes.regexp:
    case tokTypes.string:
        return escapeToken(input.substring(token.start, token.end))
    case tokTypes.template:
        return escapeToken(token.value);
    case tokTypes.relational:
    case tokTypes.bitshift:
        if (token.value[0] === '<') {
            if (input.substring(token.end, token.end + 3 === '!--') ||
                input[token.end] === '/' ||
                input.substring(token.end, token.end + 6) === 'script')
                return token.value + ' ';
            else
                return token.value;
        } else {
            return handleLeadingGreaterThan(token, input);
        }
    case tokTypes.assign:
        // no need to worry about <<= – only >>= needs to be considered.
        if (token.value[0] === '>') {
            return handleLeadingGreaterThan(token, input);
        }
        return token.value;
    default:
        return token.value;
    }
    assert(false);
}
function main() {
    let argcount = process.argv.length;

    if (argcount !== 3) {
        throw Error('must have exactly one argument, the file to quote');
    }
    let buffer = fs.ReadStream(process.argv[2], 'utf-8');
    buffer.on('data', function (input) {
        let parseTree = acorn.tokenizer(input, { locations: true,
                                                 allowHashBang: true });
        // Emit CDATA opening for XML.
        process.stdout.write('//<![CDATA[\n');
        {
            let x = parseTree.getToken();
            let result = null;
            let line_number = 0;
            let offset = 0;
            while ((result = processToken(x, input)) !== null) {
                // Catch bugs
                assert.strictEqual(typeof offset, 'number');
                if (line_number > 0) {
                    if (x.loc.start.line != line_number) {
                        // Emit a newline here, to avoid problems with
                        // semicolon insertion.
                        process.stdout.write('\n');
                    } else {
                        // We only need a space between two identifier
                        // characers, or within a string or regex literal.
                        // All other space is non-significant.
                        let needs_space =
                            offset > 0 &&
                            acorn.isIdentifierChar(input.charCodeAt(x.start)) &&
                            acorn.isIdentifierChar(input.charCodeAt(offset));
                        if (needs_space) {
                            process.stdout.write(' ')
                        }
                    }
                }
                line_number = x.loc.end.line;
                offset = x.end - 1;
                process.stdout.write(result.toString());
                x = parseTree.getToken();
            }
        }
        // Emit CDATA close for XML
        process.stdout.write('//]]>\n');
    });
}
main()
