import { 
    App, 
    TFile,
    Editor, 
    MarkdownView, 
    Modal, 
    Notice, 
    Plugin, 
    PluginSettingTab, 
    Setting,
    ItemView,
    WorkspaceLeaf, 
    Menu
} from 'obsidian';

import type {
  WebdavConfig,
} from "./baseTypes";
import {
     fromWebdavItemToRemoteItem
} from "./remoteForWebdav";

import { AuthType, BufferLike, createClient } from "webdav/web";
export type { WebDAVClient } from "webdav/web";
import type {
    FileStat,
    WebDAVClient,
    RequestOptionsWithState,
    Response,
    ResponseDataDetailed,
} from "webdav/web";

// Remember to rename these classes and interfaces!
interface FilePath {
    path: string;
    basename: string;
}

class MyWebdavClient {
    client: WebDAVClient
    webdavConfig: WebdavConfig

    constructor(
    ) {
    }

    init = async (webdavConfig: WebdavConfig) => {
        this.webdavConfig = webdavConfig;
        const headers = {
            "Cache-Control": "no-cache",
        };
        this.client = createClient(webdavConfig.address, {
            username: webdavConfig.username,
            password: webdavConfig.password,
            headers: headers,
            authType: AuthType.Password,
        });
    }

    listFromRemote = async () => {  // 函数：获取远程文件夹的文件列表
        const directoryItems = await this.client.getDirectoryContents("/");
    }

    checkConnectivity = async (callbackFunc?: any) => { // 函数：检查是否能够连接到 WebDAV 服务器
        // 检查 address
        if (
            !(
                this.webdavConfig.address.startsWith("http://") ||
                this.webdavConfig.address.startsWith("https://")
            )
        ) {
            const err = "Error: the url should start with http(s):// but it does not!";
            console.log(err);
            if (callbackFunc !== undefined) {
                callbackFunc(err);
            }
            return false;
        }

        // 检查连接性
        try {
            const remotePath = this.webdavConfig.remoteBaseDir || '';
            const res = (await this.client.stat(remotePath, {
                details: false,
            })) as FileStat;
            const results = fromWebdavItemToRemoteItem(res, remotePath);
            if (results === undefined) {
                const err = "results is undefined";
                console.log(err);
                if (callbackFunc !== undefined) {
                    callbackFunc(err);
                }
                return false;
            }
            return true;
        } catch (err) {
            console.log(err);
            if (callbackFunc !== undefined) {
                callbackFunc(err);
            }
            return false;
        }
    }
}

const AliyunListViewType = 'aliyun-driver';

class AliyunFilesListView extends ItemView {
    private readonly plugin: AliyunDriverConnectorPlugin;
    private data: AliyunDriverData;
    private markdownFiles: TFile[] = [];

    constructor(leaf: WorkspaceLeaf, plugin: AliyunDriverConnectorPlugin, data:AliyunDriverData) {
        super(leaf);

        this.plugin = plugin;
        this.data = data;

        this.markdownFiles = this.app.vault.getMarkdownFiles();
    }

    public async onOpen(): Promise<void> {
        // 清空 view 的内容
        this.contentEl.empty();

        // 以 tree-view 的形式展示所有的 markdown 文件和它们的标题
        this.markdownFiles.forEach(file => {
            const fileDiv = this.contentEl.createDiv();
            fileDiv.setText(file.basename);
            
            this.app.vault.read(file).then(content => {
                const titleLines = content.split('\n').filter(line => line.startsWith('# '));
                
                titleLines.forEach(line => {
                    const titleDiv = fileDiv.createDiv();
                    titleDiv.setText(line);
                });
            });
        });
    }

    public getViewType(): string {
        return AliyunListViewType;
    }

    public getDisplayText(): string {
        return 'Aliyun Files';
    }

    public getIcon(): string {
        return 'list';
    }

    public onHeaderMenu(menu: Menu): void {
        menu.addItem((item) => {
            item
            .setTitle('Upload')
            .setIcon('upload')
            .onClick(async () => {
                console.log('upload');
            });
        });
    }

    public readonly redraw = (): void => {
    }

}

interface AliyunDriverData {
    files: FilePath[];
}

const DEFAULT_DATA: AliyunDriverData = {
    files: [],
};

export default class AliyunDriverConnectorPlugin extends Plugin {
    public data: AliyunDriverData;
    public view: AliyunFilesListView;
    public webdavClient: MyWebdavClient;

	async onload() {
		await this.loadData();

        // 终端输出插件版本
        console.log('Aliyun Driver Connector: Loading plugin v' + this.manifest.version);

        this.webdavClient = new MyWebdavClient();

        // webdav client init
        const DefaultWebdavConfig: WebdavConfig = {
            address: 'http://red0orange.plus:8080',
            username: 'admin',
            password: 'admin',
            authType: 'basic',
            manualRecursive: false,
        };
        this.webdavClient.init(DefaultWebdavConfig);

        // webdav client check connectivity
        console.log(this.webdavClient.checkConnectivity());

        // 注册 view
        this.registerView(
            AliyunListViewType,
            (leaf) => (this.view = new AliyunFilesListView(leaf, this, this.data))
        )

        // 注册打开 View 的命令
        this.addCommand({
            id: 'aliyun-driver-connector-open',
            name: 'Open Aliyun Files',
            callback: async () => {
                let [leaf] = this.app.workspace.getLeavesOfType(AliyunListViewType);
                if (!leaf) {
                    leaf = this.app.workspace.getLeftLeaf(false);
                    await leaf.setViewState({ type: AliyunListViewType });
                }

                this.app.workspace.revealLeaf(leaf);
            }
        });
        (this.app.workspace as any).registerHoverLinkSource(
            AliyunListViewType,
            {
                display: 'Aliyun Files',
                defaultMod: true,
            },
        );

        // 当 layout 准备好时，构建 view
        if (this.app.workspace.layoutReady) {
            this.initView();    
        } else {
            this.registerEvent(this.app.workspace.on('layout-ready', this.initView));
        }

		// 注册设置页面
		this.addSettingTab(new AliyunDriverConnectorSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {
        (this.app.workspace as any).unregisterHoverLinkSource(AliyunListViewType);
	}

    public redraw = async (): Promise<void> => {
        // webdav client reinit
        await this.webdavClient.init(this.webdavClient.webdavConfig);

        // view 重绘
        await this.view.redraw();
    }

    private readonly initView = async (): Promise<void> => {
        let leaf: WorkspaceLeaf | undefined;
        for (leaf of this.app.workspace.getLeavesOfType(AliyunListViewType)) {
            if (leaf.view instanceof AliyunFilesListView) {
                return;
            }
            await leaf.setViewState({ type: 'empty' });
            break;
        }
        (leaf ?? this.app.workspace.getLeftLeaf(false)).setViewState({
            type: AliyunListViewType,
            active: true,
        });
    }

    public async loadData(): Promise<void> {
        this.data = Object.assign(DEFAULT_DATA, await super.loadData());
    }

    public async saveData(): Promise<void> {
        await super.saveData(this.data);
    }
}

class AliyunDriverConnectorSettingTab extends PluginSettingTab {
    private readonly plugin: AliyunDriverConnectorPlugin;

    constructor(app: App, plugin: AliyunDriverConnectorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    public display(): void {
        const { containerEl } = this;
        containerEl.empty();
        
        // 标题
        containerEl.createEl('h2', { text: 'Aliyun Driver Connector Settings' });
        // aliyun driver webdav 配置
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: address')
            .setDesc('Aliyun Driver WebDAV 服务器的端口')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', '127.0.0.1:5050');
                text.setValue(this.plugin.webdavClient.webdavConfig.address.toString());
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.address = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: user')
            .setDesc('Aliyun Driver WebDAV 服务器的用户名')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.username);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.username = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });
        new Setting(containerEl)
            .setName('Aliyun Driver WebDAV: password')
            .setDesc('Aliyun Driver WebDAV 服务器的密码')
            .addText((text) => {
                text.inputEl.setAttr('type', 'text');
                text.inputEl.setAttr('placeholder', 'admin');
                text.setValue(this.plugin.webdavClient.webdavConfig.password);
                text.inputEl.onblur = (e: FocusEvent) => {
                    this.plugin.webdavClient.webdavConfig.password = (e.target as HTMLInputElement).value;
                    this.plugin.redraw();
                }
            });
        
    }
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}