/*
-- dbg2mlb.js --

This utility converts a ca65 dbg file to a Mesen mlb file.
Not all features of the dbg file are supported by Mesen (Notably anonymous labels)
and will therefore be omitted from the mlb file. 

Usage : dbg2mlb <input dbg file> <output mlb file> [-b:<base>] [-e:<W | S>]
        -b : Set rom base offset, default is 0x10 due to Mesen stripping the iNes header
        -e : Set specify handling of labels in the $6000:$7FFF range. Default is W
                 w : Expansion range is Work RAM
                 s : Expansion range is Battery backed Save RAM

 eg; node mlb2dbg.js cart.dbg cart.mlb -b:0x10 -e:s
        Specifies to input cart.dbg and output cart.mlb using a base offset of 0x10 and
        labels in the $6000:$7FFF range are treated as Save RAM labels.

 Good luck, have fun! -Slush
 */
 
// GLOBAL_BASE
// Offset adjustment for iNES headers.
// Added because Mesen likes to strip the iNES header in the debugger view.
var GLOBAL_BASE = 0x10; 

// GLOBAL_EXT_RAMTYPE 
// Set to 'W' or 'S' to set the usage of labels in the $6000:$7FFF memory block.
// W : Expansion Work RAM
// S : Battery backed Save RAM
var GLOBAL_EXT_RAMTYPE = 'W'; 

const fs = require('node:fs') // Filesystem module
const readline = require('node:readline') // Text line parsing module

// CC65 DBG file entry line identifiers
const EntryNames = [
	"version",	// DBG version number
	"info", 	// Entry counts
	"csym", 	// C Symbols ?
	"file", 	// Source file locations
	"lib",  	// Library references
	"line", 	// Code Lines
	"mod",  	// ??? lookme up
	"scope",	// ??? lookme up
	"seg",		// Segment Lists
	"span",		// ??
	"sym",		// Symbols
	"type"		// ???
];

const EntryProc = {
	version : procVersion,
	info    : procInfo,
	csym    : nullProc,
	file    : nullProc,
	lib     : nullProc,
	line    : nullProc,
	mod     : nullProc,
	scope   : procMultiple,
	seg		: procMultiple,
	span	: procMultiple,	
	sym		: procSym,
	type	: nullProc
};

var Entries = {
	version : { value:{}, string:"" },
	info    : null,
	csym    : null,
	file    : null,
	lib     : null,
	line    : null,
	mod     : null,
	scope   : null,	
	seg		: null,
	span	: null,
	sym		: null,
	type	: null
};

// Entry Procedures - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

function nullProc(name, value) { }

// [version] Version of compiler or dbg file.
// { major, minor }
function procVersion (name, value) {
	var p = getProperties(value);
	Entries.version.value = p;
	Entries.version.string = "CC65 Debug v" + p.major + "." + p.minor + " File : " + inFile;
}

// [info] Counts of each datatype
// { csym, files, lib, line, mod, scope, seg, span, sym type }
function procInfo (name, value) {
	procSingle(name, value);
	for(var oName in Entries.info)
		Entries[oName] = new Array();
}
// [file] Info on each input file used for linking
// { id, name, size, mtime, mod }
function procFile (name, value) {
	var obj = getProperties(value);
	Entries.file[parseInt(obj.id)] = obj;
}

// [sym] Info on each symbol, used for generating constants and labels
// { id, name, addrsize { absolute | zeropage }, scope | parent, def,ref,val,type { lab | equ }
function procSym(name, value) { 
	var obj = getProperties(value);
	Entries.sym[parseInt(obj.id)] = obj;
}

// General purpose, generates an object from single entry data in the dbg file.
function procSingle(name, value) {
	Entries[name] = getProperties(value);
}

// General purpose, generates an array of objects from the lists in the dbg file.
function procMultiple(name, value) {
	if(Entries[name] == undefined) Entries[name] = [];
	Entries[name].push(getProperties(value));
}

// Parses a dbg line into a javascript object.
function getProperties(properties) {
	var out = {};
	properties = properties.replace(/"/g, '');
	properties = properties.split(',');
	
	for(var p in properties) {
		p = properties[p].split('=');
		out[p[0]] = p[1];
	}
	return out;
}

// Builds the reader stream.
function createReadStream() {
	try {
		io = readline.createInterface({
			input: fs.createReadStream(inFile),
			crlfDelay: Infinity
		});
	} catch {
		console.error("Some error when trying to read the input file : " + inFile);
		return null;
	}
	return io;
}

// Builds the writer stream.
function createWriteStream() {
	try {
		io = fs.createWriteStream(outFile);
	} catch {
		console.error("Some error when trying to read the input file : " + inFile);
		return null;
	}
	return io;
}

// Performs various lookup operations to determine the position of the symbol
// relative the the start of the binary.
function getBankOffset(symbol) {
	var scopeId = 0;
	var spanId = 0;
	var segId = 0;
	var seg = null;

	// Fetch scope Id
	if(symbol.scope !== undefined)
		scopeId = parseInt(symbol.scope, 10);
	else {
		scopeId = parseInt(Entries.sym[symbol.parent].scope, 10);
	}
	
	// Spans may cover multiple segments, pick the lowest scope possible.
	var spanList = Entries.scope[scopeId].span.split('+');
	spanId = spanList[0];
	spanList.forEach( id => { if(id < spanId) spanId = id; });
	
	segId = Entries.span[spanId].seg;
	seg = Entries.seg[segId];
	
	if(seg.ooffs !== undefined)
		return { base:seg.start, offset:seg.ooffs };
	return 0;
}

// Generate symbol object data for export to the mlb file.
// Performs ranging and determines the location of the symbol in the binary.
function generateSymbol(symbol) {
	var outSymbol = {
		type			: null, // One of { 'P', 'R', 'S', 'W', 'G' }
								//	P: PRG ROM labels
								//	R: RAM labels (for the NES' internal 2kb RAM)
								//	S: Save RAM labels
								//	W: Work RAM labels
								//	G: Register labels
			
		value			: null, // Constant or Address value
		valueEnd		: null, // Address range end value (may be null)
		name			: null, // Label name, as a string
		comment			: null  // Trailing comment
	}
	
	
	outSymbol.name = symbol.name;
	outSymbol.value = parseInt(symbol.val, 16);

	// Range the value and tag the symbol type appropriately.
	if(symbol.type == 'lab') {
		if(outSymbol.value < 0x2000) outSymbol.type = 'R';
		else if (outSymbol.value < 0x6000) outSymbol.type = 'G'
		else if (outSymbol.value < 0x8000) outSymbol.type = 'S'
		else outSymbol.type = 'P';
	} else {
		return null;
	}

	// Lookup offset from segment list and adjust if needed.
	// Both Mesen and CA65 have some strangeness here. But it works right?
	if(outSymbol.type == 'P') {
		outSymbol.value -= GLOBAL_BASE;
		var segment = getBankOffset(symbol);
		var offset = parseInt(segment.offset, 10);
		var base = parseInt(segment.base, 16);
		outSymbol.value += offset;
		outSymbol.value -= base;
	}
	return outSymbol;
}

function generateMLB() {
	if(writeStream == null) return;
	
	Entries.sym.forEach(symbol => {
		var s = generateSymbol(symbol);
		if(s == null) return;
		
		var outString = s.type + ":" + s.value.toString(16) + ":";
		if(s.name != null) outString += s.name;
		if(s.comment != null) outString += ":" + s.comment;
		writeStream.write(outString + "\n");
	});
}

function showUsage() {
	console.log("\n-- dbg2mlb.js --\n");
	console.log("This utility converts a ca65 dbg file to a Mesen mlb file.");
	console.log("Not all features of the dbg file are supported by Mesen");
	console.log("and will therefore be omitted from the mlb file.\n");
	console.log("Usage : dbg2mlb <input dbg file> <output mlb file> [-b:<base>] [-e:<W | S>]");
	console.log("\t-b : Set rom base offset, default is 0x10 due to Mesen stripping the iNes header");
	console.log("\t-e : Set specify handling of labels in the $6000:$7FFF range. Default is W");
	console.log("\t\t W : Expansion range is Work RAM");
	console.log("\t\t S : Expansion range is Battery backed Save RAM\n");
	console.log(" eg; node mlb2dbg.js cart.dbg cart.mlb -b:0x10 -e:S");
	console.log("\tSpecifies to input cart.dbg and output cart.mlb using a base offset of 0x10 and");
	console.log("\tlabels in the $6000:$7FFF range are treated as Save RAM labels.\n");
	console.log(" Good luck, have fun! -Slush");
}

// - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -


if(process.argv.length < 4) { showUsage(); return; }

const inFile = process.argv[2];
const outFile = process.argv[3];

for(var i = 4; i < process.argv.length; i++) {
	var a = process.argv[i].toUpperCase();
	a = a.split(':');
//	if(a.length != 2) { showUsage(); return; }
	
	var error = null;
	switch(a[0]) {
		case '-E':
			if(a[1] == 'W' || a[1] == 'S')
				GLOBAL_EXT_RAMTYPE = a[1];
			else
				error = "-e:<W | S> : Invalid expansion range type selection. Use W or S.";
			break;
			
		case '-B':
			GLOBAL_BASE = parseInt(a[1]);
			if(isNaN(GLOBAL_BASE)) 
				error = "-b:<base> : Invalid base offset provided. Please use an integer of some sort";
			break;
		default:
			error = "Inavlid argument : " + process.argv[i];
			break;
	}
	if(error != null) {
		console.error("\n" + error);
		showUsage();
		return;
	}
}
var readStream = createReadStream();
var writeStream = null;	// Create this after parsing the dbg file.

if(readStream == null) return; // Abort if there was an error creating the read/write stream.
readStream.on('line', (line) => {
	var s = line.split('\t');
	EntryProc[s[0]](s[0], s[1]); // Call the corresponding line handler in the EntryProc list
});
readStream.on('close', () => { 
	writeStream = createWriteStream();
	generateMLB(); 
});