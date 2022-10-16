# DBG2MLB

A javascript utility for converting CA65 .dbg files to Mesen .mlb files.

## Description

This utility converts a ca65 dbg file to a Mesen mlb file.
Not all features of the dbg file are supported by Mesen (Notably anonymous labels)
and will therefore be omitted from the mlb file. 


 Good luck, have fun! -Slush

### Dependencies

* Node.js


* How to run the program
* Step-by-step bullets
```
Usage : dbg2mlb <input dbg file> <output mlb file> [-b:<base>] [-e:<W | S>]
        -b : Set rom base offset, default is 0x10 due to Mesen stripping the iNes header
        -e : Set specify handling of labels in the $6000:$7FFF range. Default is W
                 w : Expansion range is Work RAM
                 s : Expansion range is Battery backed Save RAM

 eg; node mlb2dbg.js cart.dbg cart.mlb -b:0x10 -e:s
        Specifies to input cart.dbg and output cart.mlb using a base offset of 0x10 and
        labels in the $6000:$7FFF range are treated as Save RAM labels.
```
## Authors
SlushFilter
[Github - Ohwaityourealreadyhere](https://github.com/slushfilter)