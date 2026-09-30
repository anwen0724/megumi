; Megumi's per-user installation pages and directory contract, on builder's standard installer.
!include LogicLib.nsh
!include FileFunc.nsh
!include nsDialogs.nsh
!include MUI2.nsh

!define INSTALL_REGISTRY_KEY "Software\${APP_ID}"
; Supply the standard directory page ourselves to avoid builder's implicit subdirectory append.
!undef allowToChangeInstallationDirectory

!ifndef BUILD_UNINSTALLER
Var MegumiPreviousDirectory
Var MegumiDesktopShortcut
Var MegumiShortcutCheckbox
Var MegumiHome
Var MegumiPathError
Var MegumiSelectedDirectory
!endif

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
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
  ${Else}
    ${StdUtils.GetParameter} $0 "D" ""
    ${If} $0 == ""
      StrCpy $INSTDIR "$LOCALAPPDATA\Programs\Megumi"
    ${EndIf}
  ${EndIf}
  StrCpy $MegumiSelectedDirectory $INSTDIR
!macroend

!macro customInstall
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" AppId "${APP_ID}"
  WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" Version "${VERSION}"
  WriteRegDWORD HKCU "${INSTALL_REGISTRY_KEY}" DesktopShortcut $MegumiDesktopShortcut
  ${If} $MegumiDesktopShortcut == ${BST_CHECKED}
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$appExe" "" "$appExe" 0
    WinShell::SetLnkAUMI "$DESKTOP\${SHORTCUT_NAME}.lnk" "${APP_ID}"
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
  StrCpy $MegumiPathError "程序目录与用户数据目录不能相同或互相包含，请选择其它位置。"
  StrCpy $0 "$INSTDIR\"
  StrCpy $1 "$MegumiHome\"
  StrLen $2 $0
  StrCpy $3 $1 $2
  StrCmp $3 $0 done
  StrLen $2 $1
  StrCpy $3 $0 $2
  StrCmp $3 $1 done
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
  FileOpen $0 "$INSTDIR\.megumi-write-check" w
  ${If} ${Errors}
    Return
  ${EndIf}
  FileClose $0
  Delete "$INSTDIR\.megumi-write-check"
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
!endif
!macroend
