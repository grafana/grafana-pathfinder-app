# Auto-Launch Tutorial Feature

This feature allows you to automatically open a specific learning journey or documentation page when Grafana starts up. This is particularly useful for demo scenarios where you want to showcase specific Grafana features with guided tutorials.

## Configuration

### Option 1: Environment Variable (Recommended for Docker/Demo Scenarios)

Set the `GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL` environment variable:

#### Docker Compose Example
```yaml
version: '3.8'
services:
  grafana:
    image: grafana/grafana:latest
    environment:
      # Auto-launch Linux Server Integration tutorial
      - GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/
    ports:
      - "3000:3000"
    volumes:
      - grafana-storage:/var/lib/grafana
```

#### Docker Run Example
```bash
docker run -d \
  -p 3000:3000 \
  -e GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/ \
  grafana/grafana:latest
```

#### Kubernetes Example
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: grafana
spec:
  template:
    spec:
      containers:
      - name: grafana
        image: grafana/grafana:latest
        env:
        - name: GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL
          value: "https://grafana.com/docs/learning-journeys/linux-server-integration/"
```

### Option 2: Admin Configuration UI

1. Navigate to **Administration** > **Plugins**
2. Find the **Grafana Docs Plugin**
3. Click **Config**
4. Enter your tutorial URL in the **Auto-Launch Tutorial URL** field
5. Click **Save Configuration**

## Supported URL Types

### Learning Journeys
- Format: `https://grafana.com/docs/learning-journeys/{journey-name}/`
- Example: `https://grafana.com/docs/learning-journeys/linux-server-integration/`
- Behavior: Opens as an interactive learning journey with step-by-step milestones

### Documentation Pages
- Format: `https://grafana.com/docs/{path}/`
- Example: `https://grafana.com/docs/grafana/latest/alerting/`
- Behavior: Opens as a documentation page

## Use Cases

### Demo Scenarios
- **Trade Show Demos**: Pre-configure a specific tutorial that showcases your use case
- **Training Sessions**: Start sessions with relevant learning journeys
- **Customer Demos**: Show how Grafana works for specific scenarios (monitoring, alerting, etc.)

### Development & Testing
- **Feature Testing**: Automatically open documentation for features being tested
- **Documentation Review**: Quickly test documentation changes in context

### Onboarding
- **New User Experience**: Show new users how to get started with relevant tutorials
- **Role-based Onboarding**: Different tutorials for different user roles

## Common Tutorial URLs

### Learning Journeys
```bash
# Linux Server Monitoring
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/

# Kubernetes Monitoring  
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/kubernetes-monitoring/

# Application Observability
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/application-observability/
```

### Documentation Pages
```bash
# Alerting Documentation
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/grafana/latest/alerting/

# Dashboard Documentation
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/grafana/latest/dashboards/

# Data Sources Documentation
GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/grafana/latest/datasources/
```

## Behavior

1. **Startup Trigger**: The tutorial launches automatically when Grafana finishes loading (1-second delay)
2. **Panel Opening**: The docs panel will automatically open and display the specified content
3. **Content Type Detection**: The system automatically detects whether the URL is a learning journey or documentation page
4. **One-time Launch**: The tutorial only launches once per session to avoid disrupting normal usage

## Troubleshooting

### Tutorial Not Loading
- Check that the environment variable is set correctly
- Verify the URL is accessible and points to valid Grafana documentation
- Check browser console for error messages

### Environment Variable Not Working
- Ensure the exact variable name: `GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL`
- Restart Grafana after setting the environment variable
- Verify the plugin is installed and enabled

### Permission Issues
- Ensure the docs plugin has necessary permissions
- Check if authentication is required for the documentation URL

## Example Demo Scenarios

### Linux Monitoring Demo
```yaml
# docker-compose.yml for Linux monitoring demo
version: '3.8'
services:
  grafana:
    image: grafana/grafana:latest
    environment:
      - GF_PLUGINS_GRAFANA_GRAFANADOCSPLUGIN_APP_TUTORIAL_URL=https://grafana.com/docs/learning-journeys/linux-server-integration/
      - GF_INSTALL_PLUGINS=grafana-docs-plugin
    ports:
      - "3000:3000"
  
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
  
  node-exporter:
    image: prom/node-exporter:latest
    ports:
      - "9100:9100"
```

This setup will start Grafana with the Linux Server Integration tutorial automatically opened, alongside Prometheus and Node Exporter for a complete monitoring demo. 