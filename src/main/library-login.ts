import {BrowserWindow,dialog,session,shell} from 'electron'
import {setTimeout as delay} from 'node:timers/promises'
import {LIBRARY_HOME,LIBRARY_ORIGIN,type LibraryFloor} from '../shared/library'
import {schoolLoginAction,type ConnectionPhase} from '../shared/ams'
import type {AccountService} from '../services/account-service'
import {isLibraryLoginNavigation,libraryNavigationLabel} from '../security/library-navigation'
import {buildAutomaticLoginScript,buildLoginInspectionScript,isAuthenticationOrigin,isCredentialPage,SCHOOL_VERIFICATION_MESSAGE} from '../security/login-policy'
import {isAbortedNavigation,schoolLoginFailure,SCHOOL_MANUAL_LOGIN_MESSAGE,showSchoolLoginWindow} from './school-login-window'
import {parseLibraryFloors} from '../providers/library'
import {libraryFloorPageScript} from '../providers/library-floor-page'

export interface LibraryAuth {token:string;accNo:number}
export class LibraryLogin {
  readonly school=session.fromPartition('persist:xjtlu-library')
  private win:BrowserWindow|null=null
  private generation=0
  private credentialsGeneration=0
  private timer:ReturnType<typeof setInterval>|null=null
  private ticking=false
  private submitted=false
  private manual=false
  private deadline=0
  private automatic:Promise<unknown>|null=null
  private auth:LibraryAuth|null=null
  private phase:ConnectionPhase='idle'
  private message=''
  constructor(private account:AccountService,private publish:(phase:ConnectionPhase,message:string)=>void){
    this.school.setPermissionRequestHandler((_w,_p,callback)=>callback(false));this.school.setPermissionCheckHandler(()=>false)
    this.school.on('will-download',event=>event.preventDefault())
  }
  private status(phase:ConnectionPhase,message:string):void {if(this.phase!==phase||this.message!==message){this.phase=phase;this.message=message;this.publish(phase,message)}}
  private stop():void{if(this.timer)clearInterval(this.timer);this.timer=null}
  private valid(g:number,win:BrowserWindow):boolean{return g===this.generation&&this.win===win&&!win.isDestroyed()}
  read():LibraryAuth|null{return this.auth?{...this.auth}:null}
  async connect():Promise<void>{
    if(this.phase==='manual-login-required')return
    if(this.timer){if(this.phase==='verification-required')this.show();return}
    this.startLogin('background')
  }
  private watch(g:number,win:BrowserWindow):void{
    if(!this.timer)this.timer=setInterval(()=>void this.tick(g,win),750)
  }
  private startLogin(mode:'background'|'visible'|'manual'):void{
    this.stop()
    const previous=this.win
    this.win=null
    this.generation++;const g=this.generation;this.credentialsGeneration++;this.auth=null;this.submitted=false;this.deadline=Date.now()+75_000
    this.manual=mode==='manual'
    previous?.destroy()
    const win=new BrowserWindow({title:'西浦图书馆 · 官方认证',width:1180,height:820,show:mode!=='background',autoHideMenuBar:true,webPreferences:{session:this.school,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false}})
    this.win=win
    const guardNavigation=(event:{url:string;isMainFrame:boolean;preventDefault():void}):void=>{
      if(isLibraryLoginNavigation(event.url))return
      event.preventDefault()
      if(event.isMainFrame){
        const destination=libraryNavigationLabel(event.url)
        this.pageFailed(g,win,destination?`图书馆跳转被拦截（${destination}）。`:'图书馆跳转到了无法确认的页面。')
      }
    }
    win.webContents.on('will-navigate',guardNavigation)
    win.webContents.on('will-redirect',guardNavigation)
    win.webContents.setWindowOpenHandler(({url})=>{
      if(isLibraryLoginNavigation(url))this.loadPage(g,win,url)
      return {action:'deny'}
    })
    win.webContents.on('did-fail-load',(_event,code,_description,_url,mainFrame)=>{
      if(mainFrame&&code!==-3)this.pageFailed(g,win,`图书馆页面加载失败（错误码 ${code}）。`)
    })
    win.webContents.on('render-process-gone',(_event,details)=>this.pageFailed(g,win,`图书馆页面意外关闭（${details.reason}）。`))
    win.on('closed',()=>{
      if(this.win!==win)return
      this.win=null
      const wasWatching=Boolean(this.timer)
      this.stop()
      if(this.phase==='manual-login-required'){
        if(wasWatching)this.loginFailed('学校窗口已关闭。',false)
      }
      else if(!this.auth)this.status('idle','认证窗口已关闭，可重新连接学校账号。')
    })
    if(this.manual)this.status('manual-login-required',SCHOOL_MANUAL_LOGIN_MESSAGE)
    else this.status('authenticating','正在连接图书馆学校账号…')
    this.watch(g,win)
    win.webContents.on('did-finish-load',()=>void this.tick(g,win))
    this.loadPage(g,win,LIBRARY_HOME)
  }
  private loadPage(g:number,win:BrowserWindow,url:string):void{
    void win.loadURL(url).catch(error=>{
      if(!isAbortedNavigation(error))this.pageFailed(g,win,'图书馆页面加载失败，请检查网络。')
    })
  }
  private pageFailed(g:number,win:BrowserWindow,message:string):void{
    if(!this.valid(g,win)||!this.timer)return
    this.loginFailed(message,false)
    if(win.isVisible()){
      queueMicrotask(()=>void this.showPageFailure(g,win,message))
      return
    }
    this.win=null
    queueMicrotask(()=>{if(!win.isDestroyed())win.destroy()})
  }
  private async showPageFailure(g:number,win:BrowserWindow,message:string):Promise<void>{
    if(!this.valid(g,win))return
    try{
      const {response}=await dialog.showMessageBox(win,{
        type:'warning',title:'图书馆登录未完成',message,
        detail:'重试会重新打开学校登录。在浏览器打开可以单独使用图书馆预约网页。',
        buttons:['重试','在浏览器打开','关闭'],defaultId:0,cancelId:2,noLink:true
      })
      if(!this.valid(g,win))return
      if(response===0)this.startLogin('manual')
      else{
        win.close()
        if(response===1)await shell.openExternal(LIBRARY_HOME)
      }
    }catch{/* The workbench keeps the failure message and the manual login action. */}
  }
  private attention(message:string):void{
    const first=this.phase!=='verification-required'
    this.manual=true
    this.status('verification-required',message)
    if(first)this.show()
  }
  private loginFailed(message:string,keepWatching=this.manual):void{
    if(!keepWatching)this.stop()
    this.status('manual-login-required',schoolLoginFailure(message,keepWatching))
  }
  private async tick(g:number,win:BrowserWindow):Promise<void>{
    if(!this.valid(g,win)||!this.timer||this.ticking)return
    this.ticking=true
    try{
      if(win.webContents.isLoadingMainFrame())return
      const url=win.webContents.getURL()
      if(new URL(url).origin===LIBRARY_ORIGIN){
        const value:unknown=await win.webContents.executeJavaScript(`(()=>{if(location.origin!=='${LIBRARY_ORIGIN}')return null;try{const x=JSON.parse(sessionStorage.getItem('userInfo')||'{}');return {token:typeof x.token==='string'?x.token:'',accNo:x.accNo}}catch{return null}})()`)
        if(!this.valid(g,win))return
        if(value&&typeof value==='object'&&'token'in value&&typeof value.token==='string'&&value.token&&'accNo'in value&&typeof value.accNo==='number'&&Number.isSafeInteger(value.accNo)){
          this.auth={token:value.token,accNo:value.accNo};this.stop();this.status('connected','已连接学校账号，可查询具体座位和提交预约。');return
        }
      }
      if(!isAuthenticationOrigin(url))return
      const state=await win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:buildLoginInspectionScript()}])
      if(!this.valid(g,win))return
      if(state==='verification-required'){this.attention(SCHOOL_VERIFICATION_MESSAGE);return}
      if(state==='login-error'){this.loginFailed('学校登录未通过。');return}
      if(this.manual||state!=='credentials'||this.submitted||!isCredentialPage(url))return
      const cg=this.credentialsGeneration,saved=await this.account.read().catch(()=>null)
      if(!this.valid(g,win)||cg!==this.credentialsGeneration)return
      if(!saved){this.stop();this.status('credentials-required','请在“账号与设置”保存学校账号后连接。');return}
      this.submitted=true
      const task=win.webContents.executeJavaScriptInIsolatedWorld(1001,[{code:buildAutomaticLoginScript(saved,`library:${g}:${cg}`)}]);this.automatic=task
      let result:unknown;try{result=await task}finally{if(this.automatic===task)this.automatic=null}
      if(!this.valid(g,win)||cg!==this.credentialsGeneration)return
      if(result==='verification-required')this.attention(SCHOOL_VERIFICATION_MESSAGE)
      else if(!['submitted','already-submitted','wrong-page','cancelled'].includes(String(result)))this.loginFailed('学校登录表单未能自动提交。')
    }catch{/* SSO navigation can replace the document while it is being inspected. */}
    finally{
      this.ticking=false
      if(this.valid(g,win)&&this.timer&&!this.manual&&Date.now()>this.deadline){
        this.pageFailed(g,win,'图书馆认证等待超时。')
      }
    }
  }
  show():void{showSchoolLoginWindow(this.win)}
  async showLogin():Promise<void>{
    if(this.phase==='manual-login-required'){
      const win=this.win
      if(!win||win.isDestroyed()||(!this.timer&&(win.webContents.isLoadingMainFrame()||!isAuthenticationOrigin(win.webContents.getURL())))){
        this.startLogin('manual')
        return
      }
      this.manual=true
      this.watch(this.generation,win)
      this.status('manual-login-required',SCHOOL_MANUAL_LOGIN_MESSAGE)
    }
    this.show()
  }
  async openSource():Promise<void>{
    if(schoolLoginAction(this.phase))return this.showLogin()
    if(this.win&&!this.win.isDestroyed()){this.show();return}
    this.startLogin('visible')
  }
  async readFloorPage(refresh:boolean):Promise<LibraryFloor[]|null>{
    const win=this.win,g=this.generation
    if(!this.auth||!win||!this.valid(g,win))return null
    const onHome=():boolean=>{
      const url=URL.parse(win.webContents.getURL())
      return url?.origin===LIBRARY_ORIGIN&&url.hash.split('?')[0]==='#/ic/home'
    }
    if(win.isVisible()&&!onHome())return null
    if(!win.isVisible()&&(refresh||!onHome())){
      // Only reload our background window. Leave the user's open school page in place.
      if(onHome())win.webContents.reload()
      else void win.loadURL(LIBRARY_HOME).catch(()=>{})
      await delay(250)
    }
    const deadline=Date.now()+6_000
    while(this.valid(g,win)&&this.auth&&Date.now()<deadline){
      if(!win.webContents.isLoadingMainFrame()){
        if(!onHome())return null
        try{
          const data:unknown=await win.webContents.executeJavaScript(libraryFloorPageScript)
          if(!this.valid(g,win)||!this.auth||!onHome())return null
          return parseLibraryFloors(data)
        }catch{/* The site may still be rendering its floor cards. */}
      }
      await delay(250)
    }
    return null
  }
  invalidate(token:string):void{if(this.auth?.token===token){this.auth=null;this.status('expired','学校登录已过期，请重新连接图书馆账号。')}}
  async cancel():Promise<void>{this.credentialsGeneration++;const c=this.win?.webContents;if(c&&!c.isDestroyed()&&isAuthenticationOrigin(c.getURL()))await c.executeJavaScriptInIsolatedWorld(1001,[{code:'globalThis.__xjtluLoginAttempt=null'}]).catch(()=>{});await this.automatic?.catch(()=>{})}
  async reset():Promise<void>{this.generation++;this.credentialsGeneration++;this.stop();this.auth=null;this.win?.destroy();this.win=null;await this.school.clearStorageData();this.status('idle','账号已切换，请重新连接图书馆。')}
  dispose():void{this.generation++;this.credentialsGeneration++;this.stop();this.auth=null;this.win?.destroy();this.win=null}
}
