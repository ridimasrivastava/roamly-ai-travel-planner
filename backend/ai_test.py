print("AI TEST STARTED")

import os
from huggingface_hub import InferenceClient

print("Library imported")
print("Token loaded:", bool(os.getenv("HF_TOKEN")))

client = InferenceClient(
    api_key=os.getenv("HF_TOKEN")
)

print("Sending request to Hugging Face...")

response = client.chat.completions.create(
    model="openai/gpt-oss-120b",
    messages=[
        {
            "role": "user",
            "content": "Give me one short travel tip for Jaipur."
        }
    ]
)

print("AI RESPONSE:")
print(response.choices[0].message.content)