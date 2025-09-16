
curl -XPOST "http://localhost:9000/2015-03-31/functions/function/invocations" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "/var/runtime/resources/DocService/public/healthcheck.docx",
    "outputType": "pdf",
    "filetype": "docx",
    "key": "healthcheck-test"
  }'