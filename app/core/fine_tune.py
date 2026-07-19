import os
import yaml
import cv2
import numpy as np

# Monkeypatch NumPy 2.0+ to prevent AttributeError on np.trapz
if not hasattr(np, 'trapz') and hasattr(np, 'trapezoid'):
    np.trapz = np.trapezoid

import torch

# Monkeypatch torch.load to force weights_only=False under PyTorch 2.6+
_original_load = torch.load
def _patched_load(*args, **kwargs):
    kwargs['weights_only'] = False
    return _original_load(*args, **kwargs)
torch.load = _patched_load

from ultralytics import YOLO

def generate_mock_dataset(base_dir="dataset"):
    """
    Generates a structured YOLOv8 mock dataset with dummy annotated images.
    This allows verification of the entire fine-tuning pipeline.
    """
    print(f"[TRAINING PIPELINE] Generating mock dataset at: {base_dir}")
    
    # Subdirectories
    dirs = [
        "images/train",
        "images/val",
        "labels/train",
        "labels/val"
    ]
    for d in dirs:
        os.makedirs(os.path.join(base_dir, d), exist_ok=True)
        
    # Generate 8 train images and 4 val images
    def create_dummy_data(subset, count):
        for i in range(count):
            img_filename = f"dummy_{subset}_{i}.jpg"
            lbl_filename = f"dummy_{subset}_{i}.txt"
            
            img_path = os.path.join(base_dir, "images", subset, img_filename)
            lbl_path = os.path.join(base_dir, "labels", subset, lbl_filename)
            
            # Create a simple random pixel image
            img = np.random.randint(0, 255, (224, 224, 3), dtype=np.uint8)
            # Draw a circle on it to simulate some content
            cv2.circle(img, (112, 112), 40, (0, 255, 0), -1)
            cv2.imwrite(img_path, img)
            
            # Write a mock bounding box annotation
            # format: class_idx x_center y_center width height
            # We randomly assign one of the 4 classes: 0, 1, 2, or 3
            class_idx = i % 4
            annotation = f"{class_idx} 0.5 0.5 0.3 0.3\n"
            with open(lbl_path, "w") as f:
                f.write(annotation)
                
    create_dummy_data("train", 8)
    create_dummy_data("val", 4)
    
    # Write data.yaml file
    data_yaml = {
        "path": os.path.abspath(base_dir),
        "train": "images/train",
        "val": "images/val",
        "names": {
            0: "External Device",
            1: "Head Movement",
            2: "Multiple Persons",
            3: "Talking to others"
        }
    }
    
    yaml_path = os.path.join(base_dir, "data.yaml")
    with open(yaml_path, "w") as f:
        yaml.dump(data_yaml, f, default_flow_style=False)
        
    print(f"[TRAINING PIPELINE] Mock dataset generation complete. yaml at: {yaml_path}")
    return yaml_path

def train_proctor_model(data_yaml_path, epochs=3, imgsz=224, model_base="yolov8n.pt"):
    """
    Executes a fine-tuning run on a YOLOv8 base model.
    """
    print(f"[TRAINING PIPELINE] Initializing training on {model_base} with dataset {data_yaml_path}")
    
    # Load base model
    model = YOLO(model_base)
    
    # Run training
    # Set workers=0 to avoid macOS multiprocessing issues
    results = model.train(
        data=data_yaml_path,
        epochs=epochs,
        imgsz=imgsz,
        workers=0,
        verbose=True
    )
    
    print("[TRAINING PIPELINE] Training completed successfully!")
    return results
