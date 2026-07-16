import os
import torch
from app.core.inference import PlaceholderCNN

def export_model():
    # Load model structure
    model = PlaceholderCNN()
    model.eval()
    
    # Resolve paths
    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../data"))
    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, "model.onnx")
    
    # Create dummy input matching shape: [batch, channels, height, width]
    dummy_input = torch.randn(1, 3, 224, 224)
    
    print(f"[ONNX EXPORT] Exporting model to {output_path}...")
    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        export_params=True,
        opset_version=11,
        do_constant_folding=True,
        input_names=['input'],
        output_names=['output'],
        dynamic_axes={'input': {0: 'batch_size'}, 'output': {0: 'batch_size'}}
    )
    print("[ONNX EXPORT] Model successfully exported!")

if __name__ == "__main__":
    export_model()
