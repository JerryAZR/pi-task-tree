# Requirements Update

After reviewing the initial implementation, we need the following changes:

## New Features
- **JSON output mode**: Add `--json` flag for machine-readable output
- **Case insensitivity**: Words should be counted case-insensitively ("The" and "the" = same word)
- **Exclude patterns**: Support `--exclude <word>` to ignore specific words beyond stop words
- **Sort options**: Add `--sort alpha|freq` to sort by alphabetical or frequency (default: freq)

## Behavior Changes
- **Top N default**: Change default from 10 to 20 most frequent words
- **Error handling**: Instead of exiting on missing file, show warning and continue with available files

## Example Expected Output
```
$ wordfreq --json file1.txt --exclude foo
{
  "files": ["file1.txt"],
  "totalWords": 1234,
  "uniqueWords": 456,
  "topWords": [
    { "word": "programming", "count": 42 },
    { "word": "code", "count": 38 }
  ]
}
```
