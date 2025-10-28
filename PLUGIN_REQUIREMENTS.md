# Plugin Requirements for Gennit Backend

This document defines the requirements for plugins to be compatible with the Gennit plugin system that separates **Install** and **Enable** operations with comprehensive secret management.

## Manifest Requirements

### Required Fields

Your `plugin.json` manifest must include these fields:

```json
{
  "id": "unique-plugin-identifier",
  "name": "Human Readable Plugin Name",
  "version": "1.0.0",
  "description": "Brief description of plugin functionality",
  "entry": "dist/index.js",
  "events": ["event_name1", "event_name2"],
  "secrets": [
    {
      "key": "SECRET_NAME",
      "scope": "server",
      "required": true,
      "description": "Human-readable description for administrators",
      "validationHint": "Format expectations for validation"
    }
  ]
}
```

### Secret Configuration

The `secrets` array defines all secrets your plugin needs:

- **`key`** (string, required): Environment variable name (e.g., `"OPENAI_API_KEY"`)
- **`scope`** (string, required): Either `"server"` or `"forum"`
- **`required`** (boolean, required): Whether plugin can function without this secret
- **`description`** (string, required): Admin-facing explanation of what this secret is for
- **`validationHint`** (string, optional): Format expectations to help with validation

#### Secret Scope Types

- **`server`**: Secret applies to all plugin instances server-wide
- **`forum`**: Secret can be configured per-forum (for forum-scoped plugins)

### Example Secrets

```json
{
  "secrets": [
    {
      "key": "OPENAI_API_KEY",
      "scope": "server",
      "required": true,
      "description": "OpenAI API key for AI-powered content moderation",
      "validationHint": "Should start with 'sk-' and be 51 characters long"
    },
    {
      "key": "DISCORD_WEBHOOK_URL",
      "scope": "server",
      "required": true,
      "description": "Discord webhook URL for cross-posting notifications",
      "validationHint": "Must be a valid Discord webhook URL starting with https://discord.com/api/webhooks/"
    },
    {
      "key": "CUSTOM_ENDPOINT",
      "scope": "server",
      "required": false,
      "description": "Optional custom API endpoint for advanced integrations",
      "validationHint": "Must be a valid HTTPS URL"
    }
  ]
}
```

### Optional Metadata & UI fields

To provide a richer admin experience, plugins may define the following additional manifest keys:

- `metadata.author.name` / `metadata.author.url` — displayed alongside the plugin title.
- `metadata.tags` — short descriptors rendered as badges.
- `documentation.readmePath` — relative path to a Markdown README bundled with the plugin. The admin UI renders the README with MarkdownRenderer.
- `settingsDefaults` — default JSON values for server- or channel-scoped settings that are merged with administrator overrides.
- `ui.forms.server` / `ui.forms.channel` — describes sections and fields (secret inputs, toggles, numeric/text inputs) that the admin UI renders automatically.

These fields are optional but recommended so administrators can configure plugins without manual frontend work.

## Plugin Code Requirements

### Constructor Pattern

Your plugin must accept a `context` parameter and access secrets from it:

```javascript
export default class YourPlugin {
  constructor(context) {
    this.context = context;
    this.logger = context.logger;
    
    // Access server-scoped secrets
    this.apiKey = context.secrets?.server?.API_KEY;
    this.webhookUrl = context.secrets?.server?.WEBHOOK_URL;
    
    // Access forum-scoped secrets (if applicable)
    this.forumWebhook = context.secrets?.forum?.FORUM_WEBHOOK_URL;
    
    // Access settings
    this.timeout = context.settings?.server?.timeout || 30000;
    
    // Validate configuration
    this.isConfigured = this.validateConfiguration();
  }
  
  validateConfiguration() {
    const requiredSecrets = ['API_KEY'];
    const missingSecrets = requiredSecrets.filter(key => 
      !this.context.secrets?.server?.[key]
    );
    
    if (missingSecrets.length > 0) {
      this.logger.warn(`Missing required secrets: ${missingSecrets.join(', ')}`);
      return false;
    }
    
    return true;
  }
}
```

### Event Handler Requirements

Your `handleEvent` method must:

1. Check configuration status
2. Return structured response objects
3. Handle errors gracefully

```javascript
async handleEvent(event) {
  // Always check configuration first
  if (!this.isConfigured) {
    return {
      success: false,
      error: 'Plugin not configured - missing required secrets',
      configurationRequired: true
    };
  }
  
  try {
    const result = await this.processEvent(event);
    return { success: true, result };
  } catch (error) {
    this.logger.error('Plugin execution failed:', error);
    return { success: false, error: error.message };
  }
}
```

### Secret Validation (Recommended)

Implement a static `validateSecrets` method to help administrators validate secret formats:

```javascript
static validateSecrets(secrets) {
  const errors = [];
  
  // Validate API key format
  if (secrets.API_KEY) {
    if (secrets.API_KEY.length < 20) {
      errors.push('API_KEY must be at least 20 characters long');
    }
    
    if (!secrets.API_KEY.startsWith('sk-')) {
      errors.push('API_KEY must start with "sk-"');
    }
  }
  
  // Validate webhook URL format
  if (secrets.WEBHOOK_URL) {
    try {
      const url = new URL(secrets.WEBHOOK_URL);
      if (!url.protocol.startsWith('https')) {
        errors.push('WEBHOOK_URL must use HTTPS');
      }
      if (!url.hostname.includes('discord.com')) {
        errors.push('WEBHOOK_URL must be a Discord webhook URL');
      }
    } catch {
      errors.push('WEBHOOK_URL must be a valid URL');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}
```

## Response Formats

### Success Response
```javascript
{
  success: true,
  result: {
    // Any plugin-specific result data
  }
}
```

### Configuration Error Response
```javascript
{
  success: false,
  error: "Plugin not configured - missing required secrets",
  configurationRequired: true,
  missingSecrets: ["API_KEY", "WEBHOOK_URL"] // optional
}
```

### Runtime Error Response
```javascript
{
  success: false,
  error: "Descriptive error message",
  retryable: true // optional - indicates if operation can be retried
}
```

## Migration from Environment Variables

If your plugin currently uses `process.env` directly, update it:

### Before (Old Pattern)
```javascript
export default class OldPlugin {
  constructor() {
    this.apiKey = process.env.API_KEY; // ❌ Direct env access
  }
  
  async handleEvent(event) {
    if (!this.apiKey) {
      throw new Error('API_KEY not set'); // ❌ Poor error handling
    }
    // ... plugin logic
  }
}
```

### After (New Pattern)
```javascript
export default class NewPlugin {
  constructor(context) {
    this.context = context;
    this.logger = context.logger;
    
    // ✅ Context-based secret access
    this.apiKey = context.secrets?.server?.API_KEY;
    this.isConfigured = !!this.apiKey;
  }
  
  async handleEvent(event) {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'Plugin requires API_KEY to be configured',
        configurationRequired: true
      };
    }
    
    try {
      // ... plugin logic
      return { success: true, result: {} };
    } catch (error) {
      this.logger.error('Plugin failed:', error);
      return { success: false, error: error.message };
    }
  }
}
```

## Testing Requirements

### Unit Tests

Test your plugin with mock contexts:

```javascript
// test/plugin.test.js
import YourPlugin from '../src/index.js';

describe('YourPlugin', () => {
  const createMockContext = (secrets = {}) => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(), 
      error: jest.fn()
    },
    secrets: {
      server: secrets,
      forum: {}  // Forum-scoped secrets would go here
    },
    settings: {
      server: {}
    }
  });
  
  test('initializes with valid secrets', () => {
    const context = createMockContext({
      API_KEY: 'sk-valid-key-1234567890abcdef'
    });
    
    const plugin = new YourPlugin(context);
    expect(plugin.isConfigured).toBe(true);
  });
  
  test('handles missing required secrets', () => {
    const context = createMockContext({});
    
    const plugin = new YourPlugin(context);
    expect(plugin.isConfigured).toBe(false);
  });
  
  test('validates secret formats correctly', () => {
    const validSecrets = {
      API_KEY: 'sk-valid-key-1234567890abcdef'
    };
    
    const result = YourPlugin.validateSecrets(validSecrets);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
```

### Manual Testing Checklist

- [ ] Plugin loads without errors when secrets are configured
- [ ] Plugin handles missing required secrets gracefully  
- [ ] Plugin validates secret formats correctly
- [ ] Plugin degrades gracefully when optional secrets are missing
- [ ] Error messages are helpful for administrators
- [ ] Plugin works with both valid and edge-case inputs

## Deployment Checklist

Before deploying your plugin:

1. **Manifest Validation**
   - [ ] All required fields present (`id`, `name`, `version`, `entry`)
   - [ ] Secrets array properly formatted with required fields
   - [ ] Entry file path is correct
   - [ ] Version follows semantic versioning

2. **Code Requirements**
   - [ ] Uses context-based secret access (not `process.env`)
   - [ ] Implements proper error handling
   - [ ] Returns structured response objects
   - [ ] Includes secret validation method (recommended)

3. **Testing**
   - [ ] Unit tests pass
   - [ ] Manual testing completed
   - [ ] Works with missing optional secrets
   - [ ] Fails gracefully with missing required secrets

## Example: Complete Plugin

Here's a complete example of a compliant plugin:

### plugin.json
```json
{
  "id": "virus-scanner",
  "name": "Virus Scanner",
  "version": "1.0.0", 
  "description": "Scans uploaded files for viruses using VirusTotal API",
  "entry": "dist/index.js",
  "events": ["file_uploaded"],
  "secrets": [
    {
      "key": "VIRUS_TOTAL_API_KEY",
      "scope": "server",
      "required": true,
      "description": "VirusTotal API key for virus scanning",
      "validationHint": "Should be a 64-character hexadecimal string"
    },
    {
      "key": "WEBHOOK_URL",
      "scope": "server", 
      "required": false,
      "description": "Optional webhook for virus detection alerts",
      "validationHint": "Must be a valid HTTPS URL"
    }
  ],
  "settings": {
    "server": {
      "scanTimeout": {
        "type": "number",
        "default": 30000,
        "description": "Timeout in milliseconds for virus scans"
      },
      "quarantineInfected": {
        "type": "boolean",
        "default": true,
        "description": "Automatically quarantine infected files"
      }
    }
  }
}
```

### src/index.js
```javascript
export default class VirusScanner {
  constructor(context) {
    this.context = context;
    this.logger = context.logger;
    
    // Required secrets
    this.virusTotalKey = context.secrets?.server?.VIRUS_TOTAL_API_KEY;
    
    // Optional secrets
    this.webhookUrl = context.secrets?.server?.WEBHOOK_URL;
    
    // Settings
    this.scanTimeout = context.settings?.server?.scanTimeout || 30000;
    this.quarantineInfected = context.settings?.server?.quarantineInfected ?? true;
    
    // Configuration validation
    this.isConfigured = !!this.virusTotalKey;
    
    if (!this.isConfigured) {
      this.logger.error('VIRUS_TOTAL_API_KEY is required but not configured');
    }
    
    if (!this.webhookUrl) {
      this.logger.info('WEBHOOK_URL not configured - webhook alerts disabled');
    }
  }
  
  async handleEvent(event) {
    if (!this.isConfigured) {
      return {
        success: false,
        error: 'Plugin requires VIRUS_TOTAL_API_KEY to be configured',
        configurationRequired: true,
        missingSecrets: ['VIRUS_TOTAL_API_KEY']
      };
    }
    
    try {
      const scanResult = await this.scanFile(event.payload.file);
      
      if (scanResult.isInfected) {
        if (this.quarantineInfected) {
          await this.quarantineFile(event.payload.file.id);
        }
        
        // Optional webhook notification
        if (this.webhookUrl) {
          await this.sendWebhookAlert(scanResult);
        }
      }
      
      return { 
        success: true, 
        result: { 
          isInfected: scanResult.isInfected,
          virusName: scanResult.virusName,
          quarantined: scanResult.isInfected && this.quarantineInfected
        }
      };
      
    } catch (error) {
      this.logger.error('Virus scanning failed:', error);
      return { 
        success: false, 
        error: error.message,
        retryable: true
      };
    }
  }
  
  static validateSecrets(secrets) {
    const errors = [];
    
    if (secrets.VIRUS_TOTAL_API_KEY) {
      if (secrets.VIRUS_TOTAL_API_KEY.length !== 64) {
        errors.push('VIRUS_TOTAL_API_KEY must be exactly 64 characters long');
      }
      if (!/^[a-f0-9]+$/i.test(secrets.VIRUS_TOTAL_API_KEY)) {
        errors.push('VIRUS_TOTAL_API_KEY must be a hexadecimal string');
      }
    }
    
    if (secrets.WEBHOOK_URL) {
      try {
        const url = new URL(secrets.WEBHOOK_URL);
        if (!url.protocol.startsWith('https')) {
          errors.push('WEBHOOK_URL must use HTTPS');
        }
      } catch {
        errors.push('WEBHOOK_URL must be a valid URL');
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
  
  async scanFile(file) {
    // VirusTotal API call implementation
    const response = await fetch(`https://www.virustotal.com/vtapi/v2/file/scan`, {
      method: 'POST',
      headers: {
        'apikey': this.virusTotalKey
      },
      body: file.buffer
    });
    
    const result = await response.json();
    
    return {
      isInfected: result.positives > 0,
      virusName: result.positives > 0 ? result.scans[0]?.result : null,
      scanId: result.scan_id
    };
  }
  
  async quarantineFile(fileId) {
    // File quarantine implementation
    this.logger.info(`Quarantining infected file: ${fileId}`);
    // Move file to quarantine location, update database status, etc.
  }
  
  async sendWebhookAlert(scanResult) {
    // Webhook notification implementation
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'virus_detected',
        virusName: scanResult.virusName,
        timestamp: new Date().toISOString()
      })
    });
  }
}
```

Following these requirements ensures your plugins work seamlessly with the Gennit plugin system and provide a great experience for administrators configuring and managing plugins.