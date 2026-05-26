/*
 * this file will stop deleting only .bin [ the bin + merges --> bin (produced by x2t) ]
 * (READ -- 1. cextracttools.cpp:849-908 2. docx.h:185-187 3. File.cpp:1484-1492)
 * ------------------------------------------------------------------
 * LD_PRELOAD shim that prevents x2t (OnlyOffice's document converter)
 * from deleting the intermediate merged binary it produces when
 * applying a "changes" file.
 *
 * Why this exists
 *   The C++ source path in ofc-doc-server is:
 *
 *     ofc-doc-server/core/X2tConverter/src/cextracttools.cpp:849-908
 *       apply_changes() merges the input .bin with changes/changes0.json
 *       and writes the result to <binDir>/<basename>WithChanges.<ext>
 *       (e.g. "EditorWithChanges.bin").
 *
 *     ofc-doc-server/core/X2tConverter/src/lib/docx.h:185-187
 *       doct_bin2docx_dir() then serializes that merged bin to docx and
 *       unconditionally deletes the merged bin via
 *       NSFile::CFileBinary::Remove(sTargetBin).
 *
 *     ofc-doc-server/core/DesktopEditor/common/File.cpp:1484-1492
 *       NSFile::CFileBinary::Remove() ultimately calls glibc's
 *       std::remove (a.k.a. remove(3)) on Linux.
 *
 *   We want to read the merged bin from the JS layer so we can upload it
 *   as the new report.bin WITHOUT going through bin -> docx -> bin (which
 *   loses custom RGB highlights, image srcRect crops, and other bin-only
 *   formatting). By intercepting remove(3) / unlink(2) / unlinkat(2) and
 *   suppressing them for any path that looks like an
 *   "<anything>WithChanges.<ext>" file, the merged bin survives and the
 *   JS pipeline can pick it up directly.
 *
 *   The wider temp-dir cleanup in ofc-doc-server-lite (file-processor.js
 *   cleanup()) wipes the entire source/temp tree at the end of every
 *   conversion, so suppressed files don't leak.
 *
 * Scope of interception
 *   Match only basenames containing "WithChanges." - the exact pattern
 *   apply_changes() uses to construct sBinTo. Anything else (temp xml,
 *   media files, docx zip parts, etc.) is unaffected and deletes as usual.
 *
 * Build
 *   gcc -shared -fPIC -O2 -o x2t_keep_with_changes.so \
 *       x2t_keep_with_changes.c -ldl
 *
 * Use
 *   Set LD_PRELOAD=/opt/x2t_keep_with_changes.so in the env passed to the
 *   x2t child process (see ofc-doc-server-lite/server/modules/converters/
 *   x2t-converter.js).
 */

#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>

static int should_preserve(const char *path) {
    if (!path) return 0;
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    return strstr(base, "WithChanges.") != NULL;
}

typedef int (*unlink_fn)(const char *);
typedef int (*remove_fn)(const char *);
typedef int (*unlinkat_fn)(int, const char *, int);

int unlink(const char *path) {
    if (should_preserve(path)) {
        fprintf(stderr, "[x2t_keep_with_changes] suppressed unlink: %s\n", path);
        return 0;
    }
    static unlink_fn real = NULL;
    if (!real) real = (unlink_fn)dlsym(RTLD_NEXT, "unlink");
    return real ? real(path) : -1;
}

int remove(const char *path) {
    if (should_preserve(path)) {
        fprintf(stderr, "[x2t_keep_with_changes] suppressed remove: %s\n", path);
        return 0;
    }
    static remove_fn real = NULL;
    if (!real) real = (remove_fn)dlsym(RTLD_NEXT, "remove");
    return real ? real(path) : -1;
}

int unlinkat(int dirfd, const char *path, int flags) {
    if (should_preserve(path)) {
        fprintf(stderr, "[x2t_keep_with_changes] suppressed unlinkat: %s\n", path);
        return 0;
    }
    static unlinkat_fn real = NULL;
    if (!real) real = (unlinkat_fn)dlsym(RTLD_NEXT, "unlinkat");
    return real ? real(dirfd, path, flags) : -1;
}
