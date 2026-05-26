# ==============================================================
# STAGE 1: Extracting from DocumentServer
# ==============================================================

# ******** START OF STAGE 1 ********

FROM onlyoffice/documentserver:latest AS extractor

# updating package repository + installing curl for health check + zip + cleaning up package cache to reduce layer size
RUN apt-get update && apt-get install -y \
    curl \
    zip \
    && rm -rf /var/lib/apt/lists/*

COPY data/external-fonts /usr/share/fonts
RUN cp -r /var/www/onlyoffice/documentserver/core-fonts /usr/share/fonts
RUN sh /usr/bin/documentserver-generate-allfonts.sh


# ******** END OF STAGE 1 *********
# ======================================================
# build the LD_PRELOAD
# ======================================================
# This suppresses x2t's deletion of the intermediate "EditorWithChanges"
# merged-bin file (produced by apply_changes in
# ofc-doc-server/core/X2tConverter/src/cextracttools.cpp and then unconditionally
# unlinked from ofc-doc-server/core/X2tConverter/src/lib/docx.h:185-187). With
# the file preserved, bin-file-processor.js reads the merged bin directly and
# avoids the lossy bin -> docx -> bin round-trip (which would otherwise lose
# custom RGB highlights, image srcRect crops, etc.). See
# patches/x2t_keep_with_changes.c for the full rationale.
FROM amazonlinux:2023 AS shim_builder
RUN dnf install -y gcc glibc-devel && dnf clean all
COPY patches/x2t_keep_with_changes.c /tmp/x2t_keep_with_changes.c
RUN gcc -shared -fPIC -O2 -o /opt/x2t_keep_with_changes.so \
        /tmp/x2t_keep_with_changes.c -ldl

# ======================================================
# STAGE 2: AWS Lambda Runtime
# ======================================================
# ************ START OF STAGE 2 ******************



FROM public.ecr.aws/lambda/nodejs:22 AS lambda


# We can set any lambda specific envs here if required
ENV NODE_CONFIG_DIR=/var/task/config

# copying all extracted components from stage 1 [fileConverters, fonts, sdkjs]
COPY --from=extractor /var/www/onlyoffice/documentserver/server/FileConverter/bin ${LAMBDA_RUNTIME_DIR}/documentserver/server/FileConverter/bin
COPY --from=extractor /var/www/onlyoffice/documentserver/sdkjs ${LAMBDA_RUNTIME_DIR}/documentserver/sdkjs
COPY --from=extractor /var/www/onlyoffice/documentserver/web-apps/vendor/xregexp ${LAMBDA_RUNTIME_DIR}/documentserver/web-apps/vendor/xregexp

RUN mkdir -p /var/www/onlyoffice/documentserver
COPY --from=extractor /var/www/onlyoffice/documentserver/server/FileConverter/bin /var/www/onlyoffice/documentserver/server/FileConverter/bin
COPY --from=extractor /var/www/onlyoffice/documentserver/sdkjs /var/www/onlyoffice/documentserver/sdkjs
COPY --from=extractor /var/www/onlyoffice/documentserver/web-apps/vendor/xregexp /var/www/onlyoffice/documentserver/web-apps/vendor/xregexp

COPY --from=extractor /usr/share/fonts/ /usr/share/fonts/
COPY --from=shim_builder /opt/x2t_keep_with_changes.so /opt/x2t_keep_with_changes.so

#copying packageJson file
COPY package.json ${LAMBDA_TASK_ROOT}/package.json



# copying package.json for lambda function
WORKDIR ${LAMBDA_TASK_ROOT}
RUN if [ -f package.json ]; then npm install --omit=dev; else echo "No package.json in task root, skipping npm install"; fi


# copying the lambda handlers and modules
COPY server ${LAMBDA_TASK_ROOT}/server
COPY index.js ${LAMBDA_TASK_ROOT}

# copying CONFIG file
COPY server/config/default.json ${LAMBDA_TASK_ROOT}/config/default.json


CMD ["index.handler"]
# ***************************************************************** END OF STAGE 2 *********************************************************************