import type AgentClientPlugin from "../plugin";
import type { ChatMessage, MessageContent } from "../types/chat";
import type { ChatId } from "../types/session";
import { getLogger, Logger } from "../utils/logger";
import { TFile } from "obsidian";

/**
 * Context for content conversion, tracking state across messages.
 */
interface ConvertContext {
	/** Path of the export markdown file */
	exportFilePath: string;
	/** Counter for image numbering */
	imageIndex: number;
	/** Whether to include images in export */
	includeImages: boolean;
	/** Where to save images */
	imageLocation: "obsidian" | "custom" | "base64";
	/** Custom folder for images */
	imageCustomFolder: string;
}

export class ChatExporter {
	private logger: Logger;

	constructor(private plugin: AgentClientPlugin) {
		this.logger = getLogger();
	}

	async exportToMarkdown(
		messages: ChatMessage[],
		agentLabel: string,
		agentId: string,
		sessionId: string,
		sessionCreatedAt: Date,
		openFile = true,
		/**
		 * The chat's usable ID (Chat ID D7), or null when it has none yet.
		 * Written as `chat_id`; the export never creates one.
		 */
		chatId: ChatId | null = null,
	): Promise<string> {
		const settings = this.plugin.settings.exportSettings;

		// Use first message timestamp if available, fallback to session creation time
		const effectiveTimestamp =
			messages.length > 0 ? messages[0].timestamp : sessionCreatedAt;

		const baseFileName = this.generateFileName(effectiveTimestamp);
		const folderPath = settings.defaultFolder || "Agent Console";

		// Create folder if it doesn't exist
		await this.ensureFolderExists(folderPath);

		// Resolve file path considering session ID conflicts
		const filePath = this.resolveExportFilePath(
			folderPath,
			baseFileName,
			sessionId,
			chatId,
		);

		try {
			const frontmatter = this.generateFrontmatter(
				agentLabel,
				agentId,
				sessionId,
				effectiveTimestamp,
				chatId,
			);
			const chatContent = await this.convertMessagesToMarkdown(
				messages,
				agentLabel,
				filePath,
			);
			const fullContent = `${frontmatter}\n\n${chatContent}`;

			// Check if file already exists (path is already resolved for our session)
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(filePath);
			let file: TFile;

			if (existingFile instanceof TFile) {
				// File exists (same session), update it
				await this.plugin.app.vault.modify(existingFile, fullContent);
				file = existingFile;
			} else {
				// File doesn't exist, create it
				file = await this.plugin.app.vault.create(
					filePath,
					fullContent,
				);
			}

			// Open the exported file if requested
			if (openFile) {
				const leaf = this.plugin.app.workspace.getLeaf(false);
				await leaf.openFile(file);
			}

			this.logger.log(`Chat exported to: ${filePath}`);
			return filePath;
		} catch (error) {
			this.logger.error("Export error:", error);
			throw error;
		}
	}

	private async ensureFolderExists(folderPath: string): Promise<void> {
		const folder = this.plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folder) {
			await this.plugin.app.vault.createFolder(folderPath);
		}
	}

	/**
	 * Read `session_id` and `chat_id` from a file's frontmatter cache.
	 * Uses Obsidian's metadataCache (no disk I/O), one read per file.
	 */
	private getExportIdsFromFile(file: TFile): {
		sessionId: string | null;
		chatId: string | null;
	} {
		const fm = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
		const str = (v: unknown) =>
			typeof v === "string" && v !== "" ? v : null;
		return { sessionId: str(fm?.session_id), chatId: str(fm?.chat_id) };
	}

	/**
	 * Resolve the export path: the note this chat was exported to before,
	 * else the first free name.
	 *
	 * Candidates are `base.md`, `base_2.md` … `base_100.md`, read up to the
	 * first free name (at most 101 cache reads, as before Chat ID). Among the
	 * existing candidates, a `chat_id` match wins; then a `session_id` match,
	 * skipping any candidate whose `chat_id` is present and differs from ours
	 * (a different chat that once ran as this agent session). No vault scan.
	 */
	private resolveExportFilePath(
		folderPath: string,
		baseFileName: string,
		sessionId: string,
		chatId: ChatId | null,
	): string {
		const pathFor = (suffix: number) =>
			suffix === 1
				? `${folderPath}/${baseFileName}.md`
				: `${folderPath}/${baseFileName}_${suffix}.md`;

		let sessionMatch: string | null = null;
		for (let suffix = 1; suffix <= 100; suffix++) {
			const path = pathFor(suffix);
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				// First free name: our earlier export, if any, sits before it.
				return sessionMatch ?? path;
			}
			const ids = this.getExportIdsFromFile(file);
			if (chatId && ids.chatId === chatId) return path;
			const otherChat = !!chatId && !!ids.chatId && ids.chatId !== chatId;
			if (!sessionMatch && !otherChat && ids.sessionId === sessionId) {
				sessionMatch = path;
			}
			// Without a chat ID there is nothing better to find.
			if (!chatId && sessionMatch) return sessionMatch;
		}
		if (sessionMatch) return sessionMatch;

		// Safety fallback: exceeded limit, use the last checked path
		// This should rarely happen (100+ exports with same timestamp)
		this.logger.warn(
			`Too many export files with same base name: ${baseFileName}`,
		);
		return `${folderPath}/${baseFileName}_101.md`;
	}

	private generateFileName(timestamp: Date): string {
		const settings = this.plugin.settings.exportSettings;
		const template =
			settings.filenameTemplate || "agent_console_{date}_{time}";

		// Format date in local timezone: 20251115
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, "0");
		const day = String(timestamp.getDate()).padStart(2, "0");
		const dateStr = `${year}${month}${day}`;

		// Format time in local timezone: 012345
		const hours = String(timestamp.getHours()).padStart(2, "0");
		const minutes = String(timestamp.getMinutes()).padStart(2, "0");
		const seconds = String(timestamp.getSeconds()).padStart(2, "0");
		const timeStr = `${hours}${minutes}${seconds}`;

		return template.replace("{date}", dateStr).replace("{time}", timeStr);
	}

	private generateFrontmatter(
		agentLabel: string,
		agentId: string,
		sessionId: string,
		timestamp: Date,
		chatId: ChatId | null,
	): string {
		const settings = this.plugin.settings.exportSettings;

		// Format timestamp in local timezone: YYYY-MM-DDTHH:mm:ss
		const year = timestamp.getFullYear();
		const month = String(timestamp.getMonth() + 1).padStart(2, "0");
		const day = String(timestamp.getDate()).padStart(2, "0");
		const hours = String(timestamp.getHours()).padStart(2, "0");
		const minutes = String(timestamp.getMinutes()).padStart(2, "0");
		const seconds = String(timestamp.getSeconds()).padStart(2, "0");
		const localTimestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;

		const chatIdLine = chatId ? `\nchat_id: ${chatId}` : "";

		// Build tags line only if tag is specified
		const tagsLine = settings.frontmatterTag.trim()
			? `\ntags: [${settings.frontmatterTag.trim()}]`
			: "";

		return `---
created: ${localTimestamp}
agentDisplayName: ${agentLabel}
agentId: ${agentId}
session_id: ${sessionId}${chatIdLine}${tagsLine}
---`;
	}

	private async convertMessagesToMarkdown(
		messages: ChatMessage[],
		agentLabel: string,
		exportFilePath: string,
	): Promise<string> {
		const settings = this.plugin.settings.exportSettings;
		const context: ConvertContext = {
			exportFilePath,
			imageIndex: 0,
			includeImages: settings.includeImages,
			imageLocation: settings.imageLocation,
			imageCustomFolder: settings.imageCustomFolder,
		};

		let markdown = `# ${agentLabel}\n\n`;

		for (const message of messages) {
			const timeStr = message.timestamp.toLocaleTimeString();
			const role = message.role === "user" ? "User" : "Assistant";

			markdown += `## ${timeStr} - ${role}\n\n`;

			for (const content of message.content) {
				markdown += await this.convertContentToMarkdown(
					content,
					context,
				);
			}

			markdown += "\n---\n\n";
		}

		return markdown;
	}

	private async convertContentToMarkdown(
		content: MessageContent,
		context: ConvertContext,
	): Promise<string> {
		switch (content.type) {
			case "text":
				return content.text + "\n\n";

			case "text_with_context": {
				// User messages with auto-mention context
				// Add auto-mention in @[[note]] format at the beginning
				let exportText = "";
				if (content.autoMentionContext) {
					const { noteName, selection } = content.autoMentionContext;
					if (selection) {
						exportText += `@[[${noteName}]]:${selection.fromLine}-${selection.toLine}\n`;
					} else {
						exportText += `@[[${noteName}]]\n`;
					}
				}
				// Add the message text (which may contain additional @[[note]] mentions)
				exportText += content.text + "\n\n";
				return exportText;
			}

			case "agent_thought":
				return `> [!info]- Thinking\n> ${content.text.split("\n").join("\n> ")}\n\n`;

			case "tool_call":
				return this.convertToolCallToMarkdown(content);

			case "terminal":
				return `### 🖥️ Terminal: ${content.terminalId.slice(0, 8)}\n\n`;

			case "plan":
				return this.convertPlanToMarkdown(content);

			case "permission_request":
				return this.convertPermissionRequestToMarkdown(content);

			case "resource_link":
				return `[${content.name}](${content.uri})\n\n`;

			case "image":
				// Skip if images are not included
				if (!context.includeImages) {
					return "";
				}

				// External URI - use as-is
				if (content.uri) {
					return `![Image](${content.uri})\n\n`;
				}

				// Base64 embedding mode
				if (context.imageLocation === "base64") {
					return `![Image](data:${content.mimeType};base64,${content.data})\n\n`;
				}

				// Save as attachment (obsidian or custom)
				try {
					context.imageIndex++;
					const attachmentPath = await this.saveImageAsAttachment(
						content.data,
						content.mimeType,
						context.exportFilePath,
						context.imageIndex,
						context.imageLocation,
						context.imageCustomFolder,
					);
					// Use filename only (Obsidian resolves it)
					const fileName = attachmentPath.split("/").pop();
					return `![[${fileName}]]\n\n`;
				} catch (error) {
					this.logger.error(
						`Failed to save image as attachment: ${error}`,
					);
					// Fallback to base64 embedding
					return `![Image](data:${content.mimeType};base64,${content.data})\n\n`;
				}

			default:
				return "";
		}
	}

	private convertToolCallToMarkdown(
		content: Extract<MessageContent, { type: "tool_call" }>,
	): string {
		let md = `### 🔧 ${content.title || "Tool"}\n\n`;

		// Add locations if present
		if (content.locations && content.locations.length > 0) {
			const locationStrs = content.locations.map((loc) =>
				loc.line != null
					? `\`${loc.path}:${loc.line}\``
					: `\`${loc.path}\``,
			);
			md += `**Locations**: ${locationStrs.join(", ")}\n\n`;
		}

		md += `**Status**: ${content.status}\n\n`;

		// Only export diffs
		if (content.content && content.content.length > 0) {
			for (const item of content.content) {
				if (item.type === "diff") {
					md += this.convertDiffToMarkdown(item);
				}
			}
		}

		return md;
	}

	private convertDiffToMarkdown(diff: {
		type: "diff";
		path: string;
		oldText?: string | null;
		newText: string;
	}): string {
		let md = `**File**: \`${diff.path}\`\n\n`;

		// Check if this is a new file
		if (
			diff.oldText === null ||
			diff.oldText === undefined ||
			diff.oldText === ""
		) {
			md += "```diff\n";
			diff.newText.split("\n").forEach((line) => {
				md += `+ ${line}\n`;
			});
			md += "```\n\n";
			return md;
		}

		// Generate proper diff format
		const oldLines = diff.oldText.split("\n");
		const newLines = diff.newText.split("\n");

		md += "```diff\n";

		// Show removed lines
		oldLines.forEach((line) => {
			md += `- ${line}\n`;
		});

		// Show added lines
		newLines.forEach((line) => {
			md += `+ ${line}\n`;
		});

		md += "```\n\n";
		return md;
	}

	private convertPlanToMarkdown(
		content: Extract<MessageContent, { type: "plan" }>,
	): string {
		let md = `> [!plan] Plan\n`;
		for (const entry of content.entries) {
			const status =
				entry.status === "completed"
					? "✅"
					: entry.status === "in_progress"
						? "🔄"
						: "⏳";
			md += `> ${status} ${entry.content}\n`;
		}
		md += `\n`;
		return md;
	}

	private convertPermissionRequestToMarkdown(
		content: Extract<MessageContent, { type: "permission_request" }>,
	): string {
		const status = content.isCancelled ? "Cancelled" : "Requested";
		return `### ⚠️ Permission: ${content.toolCall.title || "Unknown"} (${status})\n\n`;
	}

	/**
	 * Save a base64-encoded image as an attachment file.
	 * Uses Obsidian's attachment settings to determine the save location.
	 * Skips saving if the file already exists.
	 */
	private async saveImageAsAttachment(
		base64Data: string,
		mimeType: string,
		exportFilePath: string,
		imageIndex: number,
		imageLocation: "obsidian" | "custom",
		imageCustomFolder: string,
	): Promise<string> {
		const ext = this.getExtensionFromMimeType(mimeType);

		// Generate image filename based on export filename
		const exportFileName = exportFilePath.replace(/\.md$/, "");
		const baseName = exportFileName.split("/").pop() || "image";
		const imageFileName = `${baseName}_${String(imageIndex).padStart(3, "0")}.${ext}`;

		let attachmentPath: string;

		if (imageLocation === "custom") {
			// Save to custom folder
			const folder = imageCustomFolder || "Agent Console";
			await this.ensureFolderExists(folder);
			attachmentPath = `${folder}/${imageFileName}`;

			// Check if file already exists
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(attachmentPath);
			if (existingFile instanceof TFile) {
				this.logger.log(
					`Image already exists, skipping: ${attachmentPath}`,
				);
				return attachmentPath;
			}
		} else {
			// Use Obsidian's attachment folder settings
			attachmentPath =
				await this.plugin.app.fileManager.getAvailablePathForAttachment(
					imageFileName,
					exportFilePath,
				);

			// Check if file already exists by comparing paths
			// getAvailablePathForAttachment returns the original name if it doesn't exist,
			// or adds a suffix (e.g., "image_001 1.png") if it does exist.
			if (!attachmentPath.endsWith(imageFileName)) {
				// File exists - return the original path (without suffix)
				const originalPath = attachmentPath.replace(
					/ \d+(\.[^.]+)$/,
					"$1",
				);
				this.logger.log(
					`Image already exists, skipping: ${originalPath}`,
				);
				return originalPath;
			}
		}

		// Save the image
		const binaryData = this.base64ToArrayBuffer(base64Data);
		await this.plugin.app.vault.createBinary(attachmentPath, binaryData);
		this.logger.log(`Image saved as attachment: ${attachmentPath}`);

		return attachmentPath;
	}

	/**
	 * Get file extension from MIME type.
	 */
	private getExtensionFromMimeType(mimeType: string): string {
		const map: Record<string, string> = {
			"image/png": "png",
			"image/jpeg": "jpg",
			"image/gif": "gif",
			"image/webp": "webp",
		};
		return map[mimeType] || "png";
	}

	/**
	 * Convert base64 string to ArrayBuffer.
	 */
	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binaryString = atob(base64);
		const bytes = new Uint8Array(binaryString.length);
		for (let i = 0; i < binaryString.length; i++) {
			bytes[i] = binaryString.charCodeAt(i);
		}
		return bytes.buffer;
	}
}
