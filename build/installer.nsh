; Megumi's per-user installation pages and directory contract, on builder's standard installer.
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include MUI2.nsh
!include WordFunc.nsh

!define INSTALL_REGISTRY_KEY "Software\${APP_ID}"
; Supply the standard directory page ourselves to avoid builder's implicit subdirectory append.
!undef allowToChangeInstallationDirectory
Var MegumiHome

!ifndef BUILD_UNINSTALLER
Var MegumiPreviousDirectory
Var MegumiDesktopShortcut
Var MegumiShortcutCheckbox
Var MegumiPathError
Var MegumiSelectedDirectory
Var MegumiCommandDirectory
!else
Var MegumiManifest
Var MegumiEntry
Var MegumiOwnedPath
Var MegumiEntryKind
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    ; Preserve NSIS's native /D parsing, including spaces, before builder resets the directory.
    StrCpy $MegumiCommandDirectory $INSTDIR
  !endif
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 Megumi ${VERSION}"
  !define MUI_WELCOMEPAGE_TEXT "此向导将为当前 Windows 用户安装 Megumi。$\r$\n$\r$\n你可以选择安装位置和桌面快捷方式。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  !define MUI_PAGE_CUSTOMFUNCTION_PRE MegumiDirectoryPre
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE MegumiDirectoryLeave
  !define MUI_DIRECTORYPAGE_VERIFYONLEAVE
  !insertmacro MUI_PAGE_DIRECTORY
  Page custom MegumiOptionsPage MegumiOptionsLeave
!macroend

!macro customInit
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/allusers" $1
  ${IfNot} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Megumi 仅支持为当前用户安装。" /SD IDOK
    SetErrorLevel 1
    Quit
  ${EndIf}
  !insertmacro setInstallModePerUser
  StrCpy $hasPerMachineInstallation "0"
  ReadRegStr $MegumiPreviousDirectory HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCpy $MegumiDesktopShortcut ${BST_CHECKED}
  ${If} $MegumiPreviousDirectory != ""
    StrCpy $INSTDIR $MegumiPreviousDirectory
    ReadRegDWORD $MegumiDesktopShortcut HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" Version
    ${VersionCompare} $0 "${VERSION}" $1
    ${If} $1 == 1
      MessageBox MB_OK|MB_ICONSTOP "已安装的版本较新，不能降级。" /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  ${Else}
    ${StdUtils.GetParameter} $0 "D" ""
    ${If} $0 == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Megumi"
    ${Else}
      StrCpy $INSTDIR $MegumiCommandDirectory
    ${EndIf}
  ${EndIf}
  StrCpy $MegumiSelectedDirectory $INSTDIR
!macroend

; Both installation and uninstallation wait for a normal exit; neither kills the application.
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ${If} $MegumiPreviousDirectory != ""
      StrCpy $INSTDIR $MegumiPreviousDirectory
    ${EndIf}
    Call MegumiValidateDirectory
    ${If} $MegumiPathError != ""
      MessageBox MB_OK|MB_ICONSTOP "$MegumiPathError" /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  !endif
  StrCpy $R1 0
  ${Do}
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${If} $R0 != 0
      ${ExitDo}
    ${EndIf}
    ${If} ${isUpdated}
    ${AndIf} $R1 < 10
      Sleep 500
      IntOp $R1 $R1 + 1
    ${Else}
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "请正常退出 Megumi 后重试。安装程序不会强行结束应用。" /SD IDCANCEL IDRETRY +3
      SetErrorLevel 1
      Quit
    ${EndIf}
  ${Loop}
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "卸载 Megumi"
  !define MUI_WELCOMEPAGE_TEXT "此向导仅移除 Megumi 程序和系统入口。$\r$\n$\r$\n用户数据目录：$MegumiHome$\r$\n$\r$\n该目录、外部工作区及安装目录中的额外文件都会保留。"
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!macro customUnInit
  ReadEnvStr $MegumiHome "MEGUMI_HOME"
  ${If} $MegumiHome == ""
    StrCpy $MegumiHome "$PROFILE\.megumi"
  ${EndIf}
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--delete-app-data" $1
  ${IfNot} ${Errors}
    SetErrorLevel 1
    Quit
  ${EndIf}
!macroend

!macro customRemoveFiles
  Call un.MegumiRemoveOwnedFiles
  ${IfNot} ${isKeepShortcuts}
    Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" AppId "${APP_ID}"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" Version "${VERSION}"
  WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut $MegumiDesktopShortcut
  ${If} $MegumiDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ; Refresh this item only after the replacement executable and shortcut are in place.
    ; SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSH.
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x1005, w "$DESKTOP\${SHORTCUT_NAME}.lnk", p 0)'
  ${EndIf}
!macroend

!macro customHeader
!ifndef BUILD_UNINSTALLER
Function MegumiDirectoryPre
  ${If} $MegumiPreviousDirectory != ""
    StrCpy $INSTDIR $MegumiPreviousDirectory
    Abort
  ${EndIf}
  StrCpy $INSTDIR $MegumiSelectedDirectory
FunctionEnd

Function MegumiDirectoryLeave
  ; NSIS commits the directory edit after this callback; read the actual user input first.
  ${NSD_GetText} $mui.DirectoryPage.Directory $INSTDIR
  Call MegumiValidateDirectory
  ${If} $MegumiPathError != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$MegumiPathError"
    Abort
  ${EndIf}
  StrCpy $MegumiSelectedDirectory $INSTDIR
FunctionEnd

; Validates the final directory at the user-facing boundary, without changing the selected path.
Function MegumiValidateDirectory
  StrCpy $MegumiPathError "请选择本地磁盘中的完整目录，不能选择磁盘根目录：$INSTDIR"
  StrCpy $0 $INSTDIR 1 1
  ${If} $0 != ":"
    StrCpy $MegumiPathError "目录必须使用本地磁盘盘符：$INSTDIR"
    Return
  ${EndIf}
  StrCpy $0 $INSTDIR 1 2
  ${If} $0 != "\"
  ${AndIf} $0 != "/"
    StrCpy $MegumiPathError "目录必须使用绝对路径：$INSTDIR"
    Return
  ${EndIf}
  ; Windows resolves nonexistent directories too; NSIS GetFullPathName requires an existing path.
  System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i.r1'
  ${If} $1 == 0
    Return
  ${EndIf}
  StrCpy $INSTDIR $0
  StrCpy $0 $INSTDIR 1 -1
  ${If} $0 == "\"
    StrCpy $INSTDIR $INSTDIR -1
  ${EndIf}
  StrLen $0 $INSTDIR
  ${If} $0 <= 3
    StrCpy $MegumiPathError "不能安装到磁盘根目录：$INSTDIR"
    Return
  ${EndIf}
  ReadEnvStr $MegumiHome "MEGUMI_HOME"
  ${If} $MegumiHome == ""
    StrCpy $MegumiHome "$PROFILE\.megumi"
  ${EndIf}
  System::Call 'kernel32::GetFullPathNameW(w "$MegumiHome", i ${NSIS_MAX_STRLEN}, w .r0, p 0)'
  StrCpy $MegumiHome $0
  StrCpy $0 $MegumiHome 1 -1
  ${If} $0 == "\"
    StrCpy $MegumiHome $MegumiHome -1
  ${EndIf}
  StrCpy $MegumiPathError "程序目录与用户数据目录不能相同或互相包含，请选择其它位置。"
  StrCpy $0 "$INSTDIR\"
  StrCpy $1 "$MegumiHome\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  StrCmp $3 $0 done
  StrLen $2 $1
  StrCpy $3 $0 $2
  StrCmp $3 $1 done
  ; Do not follow directory junctions into Home or another installation.
  StrCpy $MegumiPathError "安装位置不能经过目录链接，请选择实际目录。"
  StrCpy $4 $INSTDIR
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r4) i.r5'
    ${If} $5 != -1
      IntOp $5 $5 & 0x400
      ${If} $5 != 0
        Return
      ${EndIf}
    ${EndIf}
    ${GetParent} $4 $4
  ${LoopUntil} $4 == ""
  ${If} $MegumiPreviousDirectory == ""
    StrCpy $MegumiPathError "请选择空目录；安装程序不会删除目录中的其他文件。"
    FindFirst $0 $1 "$INSTDIR\*.*"
    ${DoWhile} $1 != ""
      ${If} $1 != "."
      ${AndIf} $1 != ".."
        FindClose $0
        Return
      ${EndIf}
      FindNext $0 $1
    ${Loop}
    FindClose $0
  ${EndIf}
  StrCpy $MegumiPathError "无法写入此目录，请选择当前用户可写的位置。"
  StrCpy $3 "0"
  ${IfNot} ${FileExists} "$INSTDIR\*.*"
    StrCpy $3 "1"
  ${EndIf}
  ClearErrors
  CreateDirectory "$INSTDIR"
  GetTempFileName $2 "$INSTDIR"
  FileOpen $0 "$2" w
  ${If} ${Errors}
    Return
  ${EndIf}
  FileClose $0
  Delete "$2"
  ${If} $3 == "1"
    RMDir "$INSTDIR"
  ${EndIf}
  StrCpy $MegumiPathError ""
  done:
FunctionEnd

Function MegumiOptionsPage
  ${If} $MegumiPreviousDirectory != ""
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "安装选项" "确认安装位置和桌面快捷方式。"
  nsDialogs::Create 1018
  Pop $0
  ${NSD_CreateLabel} 0 0 100% 36u "安装位置：$INSTDIR"
  Pop $0
  ${NSD_CreateCheckbox} 0 45u 100% 14u "创建桌面快捷方式"
  Pop $MegumiShortcutCheckbox
  ${NSD_SetState} $MegumiShortcutCheckbox $MegumiDesktopShortcut
  nsDialogs::Show
FunctionEnd

Function MegumiOptionsLeave
  ${NSD_GetState} $MegumiShortcutCheckbox $MegumiDesktopShortcut
  Call MegumiValidateDirectory
  ${If} $MegumiPathError != ""
    MessageBox MB_OK|MB_ICONEXCLAMATION "$MegumiPathError"
    Abort
  ${EndIf}
FunctionEnd
!else
; Validate every manifest path before deleting anything. Only empty directories may be removed.
Function un.MegumiReadEntry
  FileReadUTF16LE $MegumiManifest $MegumiEntry
  ${If} ${Errors}
    StrCpy $MegumiEntry ""
    Return
  ${EndIf}
  StrCpy $MegumiEntry $MegumiEntry -2
  StrCpy $MegumiEntryKind $MegumiEntry 2
  ${If} $MegumiEntryKind != "F|"
  ${AndIf} $MegumiEntryKind != "D|"
    Goto invalid_manifest
  ${EndIf}
  StrCpy $MegumiEntry $MegumiEntry "" 2
  StrCpy $MegumiOwnedPath "$INSTDIR\$MegumiEntry"
  System::Call 'kernel32::GetFullPathNameW(w "$MegumiOwnedPath", i ${NSIS_MAX_STRLEN}, w .r0, p 0) i.r1'
  ${If} $1 == 0
  ${OrIf} $0 != $MegumiOwnedPath
    Goto invalid_manifest
  ${EndIf}
  StrCpy $4 $MegumiOwnedPath
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w r4) i.r5'
    ${If} $5 != -1
      IntOp $5 $5 & 0x400
      ${If} $5 != 0
        Goto invalid_manifest
      ${EndIf}
    ${EndIf}
    ${GetParent} $4 $4
  ${LoopUntil} $4 == ""
  Return
  invalid_manifest:
    FileClose $MegumiManifest
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "安装文件清单或目录链接无效，请修复安装后重试卸载。" /SD IDOK
    Quit
FunctionEnd

Function un.MegumiRemoveOwnedFiles
  ClearErrors
  FileOpen $MegumiManifest "$INSTDIR\.megumi-owned-files" r
  ${If} ${Errors}
    SetErrorLevel 1
    MessageBox MB_OK|MB_ICONSTOP "安装文件清单缺失，请修复安装后重试卸载。" /SD IDOK
    Quit
  ${EndIf}
  ; Skip the UTF-16 BOM, then check all entries before the removal pass.
  FileSeek $MegumiManifest 2 SET
  ${Do}
    Call un.MegumiReadEntry
  ${LoopUntil} $MegumiEntry == ""
  FileSeek $MegumiManifest 2 SET
  ${Do}
    ClearErrors
    Call un.MegumiReadEntry
    ${If} $MegumiEntry == ""
      ${ExitDo}
    ${EndIf}
    ${If} $MegumiEntryKind == "F|"
      ClearErrors
      Delete "$MegumiOwnedPath"
      ${If} ${Errors}
        FileClose $MegumiManifest
        SetErrorLevel 1
        MessageBox MB_OK|MB_ICONSTOP "无法移除程序文件，请关闭占用它的程序后重试：$MegumiOwnedPath" /SD IDOK
        Quit
      ${EndIf}
    ${Else}
      RMDir "$MegumiOwnedPath"
    ${EndIf}
  ${Loop}
  FileClose $MegumiManifest
  Delete "$INSTDIR\.megumi-owned-files"
  SetOutPath $TEMP
  RMDir "$INSTDIR"
FunctionEnd
!endif
!macroend
