# Toy Project: Word Frequency Analyzer

## Overview
Build a CLI tool that analyzes text files and reports word frequency statistics. 

## Requirements
- Accept one or more file paths as arguments
- Count total words and unique words
- Report top N most frequent words (configurable, default 10)
- Ignore common stop words (the, a, an, is, etc.)
- Output results in a clean, readable format
- Handle edge cases: empty files, no words after filtering, missing files
- Include unit tests for core logic
- Include comprehensive black-box end-to-end tests

## Example Usage
```
$ wordfreq file1.txt file2.txt
Reading: file1.txt, file2.txt
Total words: 1,234
Unique words: 456

Top 10 words:
   42: programming
   38: code
   31: function
   27: language
   ...
```

## Success Criteria
- Works on any text file
- Output is clear and informative

---

**This is a complex task.** Before writing any code, use the available tools to create a plan. Break down the work into manageable pieces, then execute step by step.
