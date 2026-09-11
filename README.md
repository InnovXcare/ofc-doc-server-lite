# ofc-doc-server-lite
ofc-doc-server-lite


place only ttf files under externalFonts
# Formatting-preserving HTML conversion

The existing conversion endpoint can preserve formatting for an HTML output by
setting `preserveFormatting` on that output:

```json
{
  "inputFile": { "type": "bin", "location": "path/to/report.bin" },
  "outputFiles": [
    { "type": "html", "key": "report", "location": "path/to/output", "preserveFormatting": true }
  ],
  "region": "ap-south-1"
}
```

This is an output option on the existing endpoint, not a separate conversion
operation. Other outputs in the same request retain their existing formatting
normalization behavior.
