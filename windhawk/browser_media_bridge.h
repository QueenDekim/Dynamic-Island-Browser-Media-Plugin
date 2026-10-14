// Local browser media bridge for the Windhawk Dynamic Island mod.
// Included after DecodeImageBytesToPixels(), MediaSnapshot and media helpers.
// State is written by the registered native messaging host, never by web pages.
#pragma once

std::wstring DIBBridgeBasePath() {
    wchar_t folder[32768] = {};
    DWORD size = GetEnvironmentVariableW(L"LOCALAPPDATA", folder, ARRAYSIZE(folder));
    if (!size || size >= ARRAYSIZE(folder)) return L"";
    return std::wstring(folder) + L"\\DynamicIslandBrowserMedia\\";
}

bool DIBBridgeReadFile(const std::wstring& path, size_t limit,
                       std::vector<uint8_t>* result, bool requireFresh = false) {
    result->clear();
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ,
                              FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    bool ok = false;
    do {
        if (requireFresh) {
            FILETIME modified{};
            FILETIME current{};
            GetSystemTimeAsFileTime(&current);
            if (!GetFileTime(file, nullptr, nullptr, &modified)) break;
            ULARGE_INTEGER a{}, b{};
            a.LowPart = current.dwLowDateTime; a.HighPart = current.dwHighDateTime;
            b.LowPart = modified.dwLowDateTime; b.HighPart = modified.dwHighDateTime;
            if (a.QuadPart >= b.QuadPart &&
                a.QuadPart - b.QuadPart > 100000000ULL) break; // 10 seconds
        }
        LARGE_INTEGER length{};
        if (!GetFileSizeEx(file, &length) || length.QuadPart <= 0 ||
            static_cast<uint64_t>(length.QuadPart) > limit) break;
        result->resize(static_cast<size_t>(length.QuadPart));
        DWORD readBytes = 0;
        if (!ReadFile(file, result->data(),
                      static_cast<DWORD>(result->size()), &readBytes, nullptr) ||
            readBytes != result->size()) break;
        ok = true;
    } while (false);
    CloseHandle(file);
    if (!ok) result->clear();
    return ok;
}

std::wstring DIBBridgeUtf8(const std::string& input) {
    if (input.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                   input.data(), static_cast<int>(input.size()),
                                   nullptr, 0);
    if (size <= 0) return {};
    std::wstring output(static_cast<size_t>(size), L'\0');
    if (!MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                              input.data(), static_cast<int>(input.size()),
                              output.data(), size)) return {};
    return output;
}

bool DIBBridgeValidCoverId(const std::string& id) {
    if (id.size() != 64) return false;
    return std::all_of(id.begin(), id.end(), [](char ch) {
        return (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f');
    });
}

bool DIBBridgeHasRecentClear() {
    const std::wstring base = DIBBridgeBasePath();
    if (base.empty()) return false;
    std::vector<uint8_t> bytes;
    if (!DIBBridgeReadFile(base + L"state.tsv", 64, &bytes, true)) return false;
    const std::string content(bytes.begin(), bytes.end());
    return content == "DIBRIDGE1\nCLEAR\n";
}

bool TryReadBrowserBridgeSnapshot(MediaSnapshot* output) {
    const std::wstring base = DIBBridgeBasePath();
    if (base.empty()) return false;

    std::vector<uint8_t> bytes;
    if (!DIBBridgeReadFile(base + L"state.tsv", 8192, &bytes, true)) return false;
    std::string raw(bytes.begin(), bytes.end());
    std::vector<std::string> lines;
    size_t start = 0;
    while (start < raw.size() && lines.size() < 12) {
        size_t end = raw.find('\n', start);
        if (end == std::string::npos) end = raw.size();
        std::string line = raw.substr(start, end - start);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        lines.push_back(std::move(line));
        start = end + 1;
    }
    if (lines.size() < 9 || lines[0] != "DIBRIDGE1") return false;
    if (lines[1] != "0" && lines[1] != "1") return false;

    MediaSnapshot next{};
    next.available = true;
    next.playing = lines[1] == "1";
    next.browserAudioFallback = true; // Don't control an unrelated Windows session.
    next.browserBridge = true;
    next.browserMediaMuted = lines.size() >= 10 && lines[9] == "1";
    next.title = DIBBridgeUtf8(lines[2]);
    next.artist = DIBBridgeUtf8(lines[3]);
    next.albumTitle = DIBBridgeUtf8(lines[4]);
    const std::wstring site = DIBBridgeUtf8(lines[5]);
    if (next.title.empty()) return false;

    next.sourceAppUserModelId = L"browser.exe";
    next.sourceName = L"Yandex Browser";
    next.sourceBadge = site.empty() ? L"WEB" : MediaSourceBadge(site);
    if (site == L"YouTube") next.sourceBadge = L"YT";
    if (site == L"Яндекс Музыка") next.sourceBadge = L"YM";

    try {
        const int64_t positionMs = std::stoll(lines[6]);
        const int64_t durationMs = std::stoll(lines[7]);
        next.endTicks = std::clamp(durationMs, int64_t{0}, int64_t{86400000}) * 10000;
        next.positionTicks = std::clamp(positionMs, int64_t{0}, int64_t{86400000}) * 10000;
    } catch (...) {
        return false;
    }
    next.lastUpdatedTicks = GetTickCount64();

    // Decode each distinct cover only once. One media polling thread owns this cache.
    static std::string cachedId;
    static BitmapPixels cachedPixels;
    const std::string& coverId = lines[8];
    if (DIBBridgeValidCoverId(coverId)) {
        if (coverId != cachedId || cachedPixels.bgra.empty()) {
            cachedPixels = {};
            std::vector<uint8_t> coverBytes;
            if (DIBBridgeReadFile(base + L"cover-" + DIBBridgeUtf8(coverId) + L".bin",
                                  500000, &coverBytes)) {
                if (!DecodeImageBytesToPixels(coverBytes, &cachedPixels)) {
                    Wh_Log(L"Browser bridge: WIC failed to decode cover (%zu bytes).",
                           coverBytes.size());
                }
            }
            cachedId = coverId;
        }
        next.art = cachedPixels;
        next.artGeneration = next.art.generation;
        next.artChangedAt = NowSeconds();
    }
    next.sourceIcon = FindMediaSourceIcon(next.sourceAppUserModelId);
    next.sourceIconGeneration = next.sourceIcon.generation;
    *output = std::move(next);
    return true;
}

bool SendBrowserBridgeCommand(const char* command, int64_t positionMs = 0) {
    const std::wstring base = DIBBridgeBasePath();
    if (base.empty()) return false;
    std::string data = std::string(command) + "\n" +
                       std::to_string(std::max(int64_t{0}, positionMs)) + "\n";
    std::wstring temp = base + L"command.new";
    std::wstring final = base + L"command.txt";
    HANDLE file = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr,
                              CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    BOOL ok = WriteFile(file, data.data(), static_cast<DWORD>(data.size()), &written, nullptr);
    CloseHandle(file);
    if (!ok || written != data.size()) {
        DeleteFileW(temp.c_str());
        return false;
    }
    if (!MoveFileExW(temp.c_str(), final.c_str(),
                     MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) {
        DeleteFileW(temp.c_str());
        return false;
    }
    return true;
}
