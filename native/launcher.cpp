// Native Messaging launcher for Windows: forwards inherited stdio to Python.
// Does not listen on a port or process protocol messages itself.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <string>
#include <vector>

static bool ReadFileAsUtf8(const std::wstring& path, std::wstring* output) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    char data[4096] = {};
    DWORD count = 0;
    BOOL success = ReadFile(file, data, sizeof(data) - 1, &count, nullptr);
    CloseHandle(file);
    if (!success || count == 0 || count > sizeof(data)-1) return false;
    while (count > 0 && (data[count - 1] == '\n' || data[count - 1] == '\r')) --count;
    if (!count) return false;
    int wideLength = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS,
                                         data, static_cast<int>(count), nullptr, 0);
    if (wideLength <= 0) return false;
    output->resize(static_cast<size_t>(wideLength));
    return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, data,
                               static_cast<int>(count), output->data(), wideLength) > 0;
}

int main() {
    std::vector<wchar_t> module(MAX_PATH * 4);
    DWORD length = GetModuleFileNameW(nullptr, module.data(),
                                      static_cast<DWORD>(module.size()));
    if (!length || length == module.size()) return 1;
    std::wstring dir(module.data(), length);
    size_t slash = dir.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return 2;
    dir.resize(slash + 1);

    std::wstring python;
    if (!ReadFileAsUtf8(dir + L"python-path.txt", &python)) return 3;

    std::wstring command = L"\"" + python + L"\" -u \"" + dir + L"host.py\"";
    std::vector<wchar_t> commandLine(command.begin(), command.end());
    commandLine.push_back(0);

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION process{};

    BOOL launched = CreateProcessW(python.c_str(), commandLine.data(), nullptr,
                                    nullptr, TRUE, CREATE_NO_WINDOW, nullptr,
                                    dir.c_str(), &startup, &process);
    if (!launched) return 4;
    CloseHandle(process.hThread);
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD exitCode = 0;
    GetExitCodeProcess(process.hProcess, &exitCode);
    CloseHandle(process.hProcess);
    return static_cast<int>(exitCode);
}
