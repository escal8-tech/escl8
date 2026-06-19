import re

with open("src/app/portal/flowbuilder/FlowBuilderContent.tsx", "r") as f:
    content = f.read()

content = content.replace('label="WhatsApp Identity"', 'label="Agent"')
content = content.replace('Edit one WhatsApp identity at a time. Drafts save under this business and selected number only.', 'Edit flow logic for one Agent at a time. Drafts save under this specific Agent.')
content = content.replace('ariaLabel="Select WhatsApp identity for flow builder"', 'ariaLabel="Select Agent for flow builder"')
content = content.replace('placeholder="Select identity"', 'placeholder="Select Agent"')
content = content.replace('Fetching the selected WhatsApp identity and its saved draft.', 'Fetching the selected Agent and its saved draft.')
content = content.replace('No WhatsApp identity available', 'No Agent available')
content = content.replace('Connect a business number first to configure its bot flow.', 'Create an Agent first to configure its bot flow.')

with open("src/app/portal/flowbuilder/FlowBuilderContent.tsx", "w") as f:
    f.write(content)

